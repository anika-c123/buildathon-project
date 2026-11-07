import { useEffect, useRef, useState } from "react";
import { useSessionUpdate } from "./useSessionUpdate.js";
import { onMessage } from "./connection.js";
import { useQuote, useQuoteRotation } from "./quotes.js";
import { useSessionTime } from "./timer.js";
import { useDeskHeartbeat, useDeskSettings } from "./deskSettings.js";
import FocusTree from "./FocusTree.jsx";
import "./desk.css";

// The desk view (http://localhost:5173/desk), projected onto the desk.
//
// DISPLAY ONLY: a projection can't be clicked, so there are no buttons here.
// Every button (step done, break, park, nudge answers, quotes, display
// settings) lives on the laptop's control screen. This page just draws the
// latest session_update: panels along the top (current step, progress + time,
// quote + focus tree) and an open, unlit "laptop space" across the bottom for
// the laptop and paper. Black projects no light, so only lines and text show.

const REENTRY_SHOW_MS = 8000; // contract §5: show a welcome-back for about 8 seconds
const CELEBRATE_MS = 1600;

// Remembers when the current break began, so the break bar knows its full length.
function useBreakLength(data) {
  const began = useRef(null);
  const endsAt = data?.break_ends_at ?? null;
  if (!endsAt) began.current = null;
  else if (began.current === null || began.current.endsAt !== endsAt) {
    began.current = { at: Date.now(), endsAt };
  }
  return began.current ? Math.max(1, endsAt - began.current.at) : 1;
}

export default function Desk() {
  const { connected, data } = useSessionUpdate();
  const settings = useDeskSettings(); // dark/light + what to show, set on the laptop
  useDeskHeartbeat(); // lets the laptop show "Projector connected"
  const time = useSessionTime(data);
  useQuoteRotation(data); // new quote each session and every 30 minutes
  const now = time.now;
  const breakLength = useBreakLength(data);

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

  // Celebration: plays whenever the number of finished steps goes up.
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
        <div className="dsk-solo">
          <Panel className="dsk-solo-panel">
            <span className="dsk-pulse" aria-hidden="true" />
            <p className="dsk-solo-line">Connecting…</p>
          </Panel>
        </div>
      </Screen>
    );
  }

  const inSession = data.status === "studying" || data.status === "break";
  if (!inSession) {
    return (
      <Screen>
        <div className="dsk-solo">
          <Panel className="dsk-solo-panel">
            <span className="dsk-orb" aria-hidden="true" />
            <p className="dsk-brand">PLocked</p>
            <p className="dsk-solo-line">Start a session on the laptop.</p>
          </Panel>
        </div>
      </Screen>
    );
  }

  const onBreak = data.status === "break";
  const breakLeft = data.break_ends_at ? clamp01((data.break_ends_at - now) / breakLength) : 0;

  return (
    <Screen>
      <div className={`dsk-grid ${settings.showQuote || settings.showTree ? "" : "no-side"}`}>
        <NowPanel
          data={data}
          steps={steps}
          onBreak={onBreak}
          breakLeft={breakLeft}
          breakOver={data.break_ends_at && now >= data.break_ends_at}
          reentry={reentry}
          celebration={celebration}
        />
        <ProgressPanel steps={steps} time={time} onBreak={onBreak} showTimer={settings.showTimer} />
        {(settings.showQuote || settings.showTree) && (
          <QuoteTreePanel
            showQuote={settings.showQuote}
            showTree={settings.showTree}
            tree={<FocusTree focusedMs={time.focusedMs} stepsDone={doneCount} stepsTotal={steps.length} />}
          />
        )}
        <div className="dsk-laptop-zone" aria-hidden="true">
          <span>Laptop space</span>
        </div>
      </div>
    </Screen>
  );
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

// The theme (dark or light desk) is picked on the laptop; see deskSettings.js.
function Screen({ children }) {
  const { theme } = useDeskSettings();
  return <div className={`dsk-screen dsk-theme-${theme}`}>{children}</div>;
}

function Panel({ className = "", tone = "", children }) {
  return <section className={`dsk-panel ${tone ? `dsk-tone-${tone}` : ""} ${className}`}>{children}</section>;
}

// ---------- Now: the big panel (step, nudge, break, welcome back) ----------

function NowPanel({ data, steps, onBreak, breakLeft, breakOver, reentry, celebration }) {
  const nudge = data.active_nudge;
  const i = data.current_step;
  const allDone = steps.length > 0 && i === -1;

  if (nudge) {
    return (
      <Panel className="dsk-now" tone="nudge">
        <p className="dsk-kicker">A gentle nudge</p>
        <h1 className="dsk-big dsk-nudge-text" key={nudge.id}>
          {nudge.message}
        </h1>
        <p className="dsk-hint">Answer on your laptop · Back to work, Break, or This is relevant</p>
      </Panel>
    );
  }

  if (onBreak) {
    const next = steps[i]?.text;
    return (
      <Panel className="dsk-now" tone="break">
        <p className="dsk-kicker">On a break</p>
        <h1 className="dsk-big">{breakOver ? "Ready when you are." : "Stretch, breathe, get some water."}</h1>
        <div className="dsk-bar dsk-bar-break" aria-hidden="true">
          <div className="dsk-bar-fill" style={{ width: `${breakLeft * 100}%` }} />
        </div>
        {next && <p className="dsk-hint">Up next: {next}</p>}
      </Panel>
    );
  }

  return (
    <Panel className="dsk-now" tone={reentry ? "welcome" : ""}>
      {reentry ? (
        <p className="dsk-kicker dsk-welcome" key={reentry.key}>
          {reentry.text}
        </p>
      ) : (
        <div className="dsk-now-head">
          <p className="dsk-kicker">{allDone ? `All ${steps.length} steps done` : `Step ${i + 1} of ${steps.length}`}</p>
          <p className="dsk-now-goal">{data.goal}</p>
        </div>
      )}
      <h1 className="dsk-big" key={i}>
        {allDone ? "Nice work!" : steps[i]?.text}
      </h1>
      {allDone ? (
        <DoneParked items={data.parked} />
      ) : (
        <div className="dsk-dots-row">
          <Dots steps={steps} current={i} celebrating={celebration !== null} />
          {celebration && <Celebration key={celebration} />}
        </div>
      )}
    </Panel>
  );
}

function Dots({ steps, current, celebrating }) {
  return (
    <ol className="dsk-dots" aria-label="Progress">
      {steps.map((step, j) => {
        const state = step.done ? "done" : j === current ? "current" : "todo";
        // The dot that just turned "done" (the one before the current step) pops.
        const justDone =
          celebrating && step.done && (j === current - 1 || (current === -1 && j === steps.length - 1));
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

function Celebration() {
  // A small burst of sparks from the dots, plus a short "Nice!".
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

// ---------- Progress + time ----------
// Thick bar: steps done, matching the laptop's progress bar.
// Time bar under it: time left, sliding down smoothly, no numbers. Pauses on a break.

function ProgressPanel({ steps, time, onBreak, showTimer }) {
  const done = steps.filter((s) => s.done).length;
  const fraction = steps.length ? done / steps.length : 0;
  return (
    <Panel className="dsk-time">
      <p className="dsk-label">
        Progress · {done} of {steps.length} steps
      </p>
      <div className="dsk-bar" aria-hidden="true">
        <div className="dsk-bar-fill" style={{ width: `${fraction * 100}%` }} />
      </div>
      {showTimer && (
        <>
          <p className="dsk-label dsk-time-label">{onBreak ? "Time · paused" : "Time"}</p>
          <div className={`dsk-timeline ${onBreak ? "is-paused" : ""}`} aria-hidden="true">
            <div className="dsk-timeline-fill" style={{ width: `${time.fraction * 100}%` }} />
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------- Quote + focus tree (changed from the laptop) ----------

// Quote on the left, focus tree on the right, in one panel. Either can be
// switched off from the laptop's "Projector display" card.
function QuoteTreePanel({ showQuote, showTree, tree }) {
  const quote = useQuote();
  return (
    <Panel className="dsk-quote">
      <div className="dsk-quote-row">
        {showQuote && (
          <div className="dsk-quote-col">
            <p className="dsk-label">A little push</p>
            <p className="dsk-quote-text" key={quote.text}>
              “{quote.text}”
            </p>
            {quote.author && <p className="dsk-quote-author">— {quote.author}</p>}
          </div>
        )}
        {showTree && (
          <div className="dsk-tree-col">
            {!showQuote && <p className="dsk-label">Focus tree</p>}
            {tree}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ---------- Parked thoughts (only once every step is done) ----------
// While working, parked thoughts stay off the desk (out of sight, so they don't
// pull attention). When all steps are done, they show here as "what's next".

function DoneParked({ items }) {
  const list = items ?? [];
  if (list.length === 0) return <p className="dsk-hint dsk-done-parked-none">Nothing parked. Enjoy the win.</p>;
  return (
    <div className="dsk-done-parked">
      <p className="dsk-label">Parked for later</p>
      <ul>
        {list.slice(-4).map((item, k) => (
          <li key={`${item.timestamp}-${k}`}>{item.text}</li>
        ))}
      </ul>
    </div>
  );
}
