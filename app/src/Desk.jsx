import { useEffect, useRef, useState } from "react";
import { useSessionUpdate } from "./useSessionUpdate.js";
import { onMessage, sendAction } from "./connection.js";
import "./desk.css";

// The projector view (http://localhost:5173/desk), shown full-screen on the desk.
// Built to be read from about a meter away on a low-resolution projector:
// every size is relative to the screen (vw/vh), dark background, calm colours,
// and no red anywhere (team rule: nudges are friendly, never alarming).
//
// Like the control screen, it never decides anything: it draws the latest
// session_update and turns button presses into user_action messages.

const REENTRY_SHOW_MS = 8000; // contract §5: show a welcome-back for about 8 seconds
const CELEBRATE_MS = 1600;

// Re-renders every second so the time bars move.
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Time spent on breaks this session, measured here in the app, so the session
// time bar can pause during a break (CLAUDE.md: "the timer runs inside the app").
// Resets when a new session starts. If the page is reloaded mid-session, breaks
// before the reload aren't counted, which is fine for a demo.
function useBreakTime(data) {
  const total = useRef(0);
  const breakStart = useRef(null);
  const session = useRef(null);
  const [, force] = useState(0);

  const startedAt = data?.started_at ?? null;
  const onBreak = data?.status === "break";

  useEffect(() => {
    if (startedAt !== session.current) {
      session.current = startedAt;
      total.current = 0;
      breakStart.current = null;
    }
    if (onBreak && breakStart.current === null) {
      breakStart.current = Date.now();
    } else if (!onBreak && breakStart.current !== null) {
      total.current += Date.now() - breakStart.current;
      breakStart.current = null;
      force((n) => n + 1);
    }
  }, [startedAt, onBreak]);

  return (now) => total.current + (breakStart.current !== null ? now - breakStart.current : 0);
}

export default function Desk() {
  const { connected, data } = useSessionUpdate();
  const now = useNow();
  const breakTime = useBreakTime(data);

  // Welcome-back message, shown for 8 seconds.
  const [reentry, setReentry] = useState(null);
  const reentryTimer = useRef(null);
  useEffect(
    () =>
      onMessage((message) => {
        if (message.type !== "reentry") return;
        setReentry({ text: message.data?.message ?? "Welcome back!", key: Date.now() });
        clearTimeout(reentryTimer.current);
        reentryTimer.current = setTimeout(() => setReentry(null), REENTRY_SHOW_MS);
      }),
    [],
  );

  // Celebration: plays whenever the number of finished steps goes up,
  // whether the button was pressed here or on the laptop.
  const [celebration, setCelebration] = useState(null);
  const lastDone = useRef({ session: null, count: 0 });
  const steps = data?.steps ?? [];
  const doneCount = steps.filter((s) => s.done).length;
  useEffect(() => {
    const session = data?.started_at ?? null;
    if (lastDone.current.session !== session) {
      lastDone.current = { session, count: doneCount };
      return;
    }
    if (doneCount > lastDone.current.count) {
      setCelebration(Date.now());
      const id = setTimeout(() => setCelebration(null), CELEBRATE_MS);
      lastDone.current.count = doneCount;
      return () => clearTimeout(id);
    }
    lastDone.current.count = doneCount;
  }, [data?.started_at, doneCount]);

  if (!connected || !data) {
    return (
      <Screen>
        <div className="dsk-center dsk-quiet">
          <span className="dsk-pulse" aria-hidden="true" />
          <p className="dsk-idle-line">Connecting…</p>
        </div>
      </Screen>
    );
  }

  if (data.status !== "studying" && data.status !== "break") {
    return (
      <Screen>
        <div className="dsk-center dsk-quiet">
          <p className="dsk-brand">PLocked</p>
          <p className="dsk-idle-line">Start a session on the laptop to begin.</p>
        </div>
      </Screen>
    );
  }

  const total = Math.max(1, (data.ends_at ?? 0) - (data.started_at ?? 0));
  const focusedMs = Math.max(0, now - data.started_at - breakTime(now));
  const timeLeft = Math.min(1, Math.max(0, 1 - focusedMs / total));

  if (data.status === "break") {
    return (
      <Screen>
        <BreakScreen data={data} now={now} />
        <TimeBar fraction={timeLeft} paused />
        <Parked items={data.parked} />
      </Screen>
    );
  }

  const i = data.current_step;
  const allDone = steps.length > 0 && i === -1;
  const nudge = data.active_nudge;

  return (
    <Screen>
      <header className="dsk-top">
        <p className="dsk-goal">{data.goal}</p>
        <ParkButton />
      </header>

      {reentry && (
        <div className="dsk-reentry" key={reentry.key} role="status">
          {reentry.text}
        </div>
      )}

      <main className="dsk-main">
        {allDone ? (
          <>
            <p className="dsk-kicker">All {steps.length} steps done</p>
            <h1 className="dsk-step">Nice work. Wrap up on the laptop when you're ready.</h1>
          </>
        ) : (
          <>
            <p className="dsk-kicker">
              Step {i + 1} of {steps.length}
            </p>
            <h1 className="dsk-step" key={i}>
              {steps[i]?.text}
            </h1>
          </>
        )}

        <Dots steps={steps} current={i} celebrating={celebration !== null} />

        {!allDone && (
          <div className="dsk-done-wrap">
            <button type="button" className="dsk-btn dsk-btn-done" onClick={() => sendAction("step_done")}>
              ✓ Step done
            </button>
            {celebration && <Celebration key={celebration} />}
          </div>
        )}
      </main>

      <Parked items={data.parked} />
      <TimeBar fraction={timeLeft} />

      {nudge && <NudgeCard nudge={nudge} />}
    </Screen>
  );
}

function Screen({ children }) {
  return <div className="dsk-screen">{children}</div>;
}

// ---------- Pieces ----------

function Dots({ steps, current, celebrating }) {
  return (
    <ol className="dsk-dots" aria-label="Progress">
      {steps.map((step, j) => {
        const state = step.done ? "done" : j === current ? "current" : "todo";
        // The dot that just turned "done" (the one before the current step) pops.
        const justDone = celebrating && step.done && (j === current - 1 || (current === -1 && j === steps.length - 1));
        return (
          <li
            key={j}
            className={`dsk-dot dsk-dot-${state} ${justDone ? "dsk-dot-pop" : ""}`}
            aria-label={`Step ${j + 1}: ${state}`}
          />
        );
      })}
    </ol>
  );
}

// A shrinking bar along the bottom edge: full at the start, empty at the end.
// No numbers on purpose: calm, never a stressful countdown.
function TimeBar({ fraction, paused = false }) {
  return (
    <div className={`dsk-timebar ${paused ? "is-paused" : ""}`} aria-hidden="true">
      <div className="dsk-timebar-fill" style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

function Celebration() {
  // A small burst of dots from the button, plus a short "Nice!" that floats up.
  const sparks = Array.from({ length: 12 }, (_, k) => k);
  return (
    <div className="dsk-celebrate" aria-hidden="true">
      {sparks.map((k) => (
        <span key={k} className="dsk-spark" style={{ "--angle": `${k * 30}deg`, "--delay": `${(k % 3) * 40}ms` }} />
      ))}
      <span className="dsk-nice">Nice!</span>
    </div>
  );
}

function NudgeCard({ nudge }) {
  const [sending, setSending] = useState(false);
  async function press(action, fields) {
    setSending(true);
    await sendAction(action, fields);
    setSending(false);
  }
  return (
    <div className="dsk-nudge-backdrop">
      <div className="dsk-nudge" role="dialog" aria-live="polite" aria-label="Nudge">
        <p className="dsk-nudge-text">{nudge.message}</p>
        <div className="dsk-nudge-buttons">
          <button
            type="button"
            className="dsk-btn dsk-btn-primary"
            disabled={sending}
            onClick={() => press("dismiss", { nudge_id: nudge.id })}
          >
            Back to work
            <Arrow />
          </button>
          <button type="button" className="dsk-btn" disabled={sending} onClick={() => press("break")}>
            Break
          </button>
          <button
            type="button"
            className="dsk-btn"
            disabled={sending}
            onClick={() => press("relevant", { nudge_id: nudge.id })}
          >
            This is relevant
          </button>
        </div>
      </div>
    </div>
  );
}

function BreakScreen({ data, now }) {
  // The break bar shrinks until break_ends_at. We remember when the break began
  // so we know the full length of the bar.
  const breakBegan = useRef(null);
  const endsAt = data.break_ends_at;
  if (breakBegan.current === null || breakBegan.current.endsAt !== endsAt) {
    breakBegan.current = { at: Date.now(), endsAt };
  }
  const length = Math.max(1, (endsAt ?? 0) - breakBegan.current.at);
  const left = endsAt ? Math.min(1, Math.max(0, (endsAt - now) / length)) : 0;
  const over = endsAt && now >= endsAt;

  const i = data.current_step;
  const next = data.steps?.[i]?.text;

  return (
    <main className="dsk-break">
      <p className="dsk-kicker dsk-kicker-break">On a break</p>
      <h1 className="dsk-step dsk-break-title">{over ? "Ready when you are." : "Stretch, breathe, get some water."}</h1>
      {endsAt && (
        <div className="dsk-breakbar" aria-hidden="true">
          <div className="dsk-breakbar-fill" style={{ width: `${left * 100}%` }} />
        </div>
      )}
      {next && <p className="dsk-break-next">Up next: {next}</p>}
      <button type="button" className="dsk-btn dsk-btn-primary dsk-btn-big" onClick={() => sendAction("resume")}>
        I'm back
        <Arrow />
      </button>
    </main>
  );
}

function ParkButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  async function park(e) {
    e.preventDefault();
    const thought = text.trim();
    if (!thought) return;
    const result = await sendAction("park", { text: thought });
    if (result.ok) {
      setText("");
      setOpen(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  if (!open) {
    return (
      <button type="button" className="dsk-park-btn" onClick={() => setOpen(true)}>
        {saved ? "Parked ✓" : "+ Park a thought"}
      </button>
    );
  }
  return (
    <form className="dsk-park-form" onSubmit={park}>
      <input
        className="dsk-park-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="Something to do later…"
        aria-label="Thought to park for later"
        autoFocus
      />
      <button type="submit" className="dsk-park-btn">
        Park
      </button>
    </form>
  );
}

function Parked({ items }) {
  if (!items?.length) return null;
  return (
    <aside className="dsk-parked">
      <p className="dsk-parked-title">Parked for later</p>
      <ul>
        {items.slice(-4).map((item, k) => (
          <li key={`${item.timestamp}-${k}`}>{item.text}</li>
        ))}
      </ul>
    </aside>
  );
}

// Right arrow in a dark circle, at the end of the main lime pill buttons.
function Arrow() {
  return (
    <span className="dsk-arrow" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
