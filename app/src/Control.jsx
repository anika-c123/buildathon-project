import { useEffect, useRef, useState } from "react";
import { useSessionUpdate } from "./useSessionUpdate.js";
import { onMessage, sendAction } from "./connection.js";
import { addQuote, nextQuote, useQuote, useQuoteRotation } from "./quotes.js";
import { useSessionTime } from "./timer.js";
import { updateDeskSettings, useDeskSettings, useProjectorConnected } from "./deskSettings.js";
import "./control.css";

// The laptop control screen (http://localhost:5173/).
// It shows one of three views, picked from what the backend last said:
//   1. Setup    — no session: type a goal, get/edit steps, start.
//   2. Studying — a session is running (or on a break): progress and every
//                 session button (step done, break, park, nudge answers).
//   3. Summary  — the session just ended: the backend's summary message.
// The screen never decides anything about the session itself (docs/CONTRACT.md):
// it sends button presses as user_action messages and draws what comes back.

const PLAN_TIMEOUT_MS = 15000; // stop the "Thinking…" spinner if no steps come back

export default function Control() {
  const { connected, data } = useSessionUpdate();
  useQuoteRotation(data); // new quote each session and every 30 minutes

  // Form fields live here (not inside the Setup view) so nothing you've typed
  // is lost if the backend restarts or you come back from the summary.
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState([]);
  const [minutes, setMinutes] = useState(60);
  const [demoMode, setDemoMode] = useState(true);

  const [planning, setPlanning] = useState(false);
  const [summary, setSummary] = useState(null);
  const [notice, setNotice] = useState(null);
  const planTimer = useRef(null);

  // Listen for the one-off messages this screen cares about.
  useEffect(
    () =>
      onMessage((message) => {
        if (message.type === "plan_result") {
          clearTimeout(planTimer.current);
          setPlanning(false);
          setSteps(message.data.steps ?? []);
          setNotice(null);
        } else if (message.type === "summary") {
          setSummary(message.data);
        } else if (message.type === "error") {
          clearTimeout(planTimer.current);
          setPlanning(false);
          setNotice(message.data?.message ?? "Something went wrong.");
        }
      }),
    [],
  );

  // Stop waiting for steps if the connection drops mid-request.
  useEffect(() => {
    if (!connected && planning) {
      clearTimeout(planTimer.current);
      setPlanning(false);
    }
  }, [connected, planning]);

  async function send(action, fields) {
    const result = await sendAction(action, fields);
    if (!result.ok) setNotice("Couldn't reach the backend — is it running?");
    return result.ok;
  }

  async function suggestSteps() {
    setNotice(null);
    setPlanning(true);
    clearTimeout(planTimer.current);
    planTimer.current = setTimeout(() => {
      setPlanning(false);
      setNotice("No steps came back. You can type them in yourself below.");
    }, PLAN_TIMEOUT_MS);
    const ok = await send("plan", { goal: goal.trim() });
    if (!ok) {
      clearTimeout(planTimer.current);
      setPlanning(false);
    }
  }

  async function start() {
    setNotice(null);
    await send("start_session", {
      goal: goal.trim(),
      steps: steps.map((s) => s.trim()).filter(Boolean),
      minutes: Number(minutes),
      demo_mode: demoMode,
    });
  }

  async function endSession() {
    setNotice(null);
    await send("end_session");
  }

  const status = data?.status;
  const inSession = status === "studying" || status === "break";

  let view;
  if (!data) {
    view = <p className="ctl-muted ctl-center">Waiting for the backend…</p>;
  } else if (inSession) {
    view = <StudyingView data={data} connected={connected} send={send} onEnd={endSession} />;
  } else if (summary) {
    view = <SummaryView summary={summary} onNewSession={() => setSummary(null)} />;
  } else {
    view = (
      <SetupView
        connected={connected}
        goal={goal}
        setGoal={setGoal}
        steps={steps}
        setSteps={setSteps}
        minutes={minutes}
        setMinutes={setMinutes}
        demoMode={demoMode}
        setDemoMode={setDemoMode}
        planning={planning}
        onSuggest={suggestSteps}
        onStart={start}
      />
    );
  }

  return (
    <div className="ctl-page">
      {!connected && (
        <div className="ctl-banner" role="status">
          <span className="ctl-pulse" aria-hidden="true" /> Connecting… (waiting for the backend on port 8000)
        </div>
      )}
      <header className="ctl-header">
        <span className="ctl-brand">
          <span className="ctl-orb" aria-hidden="true" />
          <span className="ctl-logo">PLocked</span>
        </span>
        <HeaderStatus backendConnected={connected} />
      </header>
      <div className="ctl-layout">
        <div className="ctl-main-col">
        <main className="ctl-card">
          {notice && (
            <p className="ctl-notice" role="alert">
              {notice}
            </p>
          )}
          {view}
        </main>
        <ProjectorCard />
        </div>
        <aside className="ctl-side">
          {inSession && <SeesCard activity={data.activity} camera={data.camera} />}
          <QuoteCard />
          {inSession && <ParkedCard parked={data.parked} connected={connected} send={send} />}
        </aside>
      </div>
    </div>
  );
}

// ---------- 1. Setup ----------

function SetupView({
  connected,
  goal,
  setGoal,
  steps,
  setSteps,
  minutes,
  setMinutes,
  demoMode,
  setDemoMode,
  planning,
  onSuggest,
  onStart,
}) {
  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
  const minutesOk = Number(minutes) >= 1 && Number(minutes) <= 240;
  const canStart = connected && goal.trim() && cleanSteps.length > 0 && minutesOk;

  const updateStep = (i, text) => setSteps(steps.map((s, j) => (j === i ? text : s)));
  const removeStep = (i) => setSteps(steps.filter((_, j) => j !== i));
  const addStep = () => setSteps([...steps, ""]);

  return (
    <form
      className="ctl-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canStart) onStart();
      }}
    >
      <div className="ctl-section">
        <label className="ctl-headline" htmlFor="goal">
          <strong>{greeting()},</strong> what do you want to get done?
        </label>
        <div className="ctl-row">
          <input
            id="goal"
            className="ctl-input ctl-goal"
            placeholder="e.g. Finish my Java assignment"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            className="ctl-btn ctl-btn-secondary"
            onClick={onSuggest}
            disabled={!connected || !goal.trim() || planning}
          >
            {planning ? "Thinking…" : "Suggest steps"}
          </button>
        </div>
      </div>

      <div className="ctl-section">
        <span className="ctl-label">Steps</span>
        {steps.length === 0 ? (
          <p className="ctl-muted">Press "Suggest steps", or add your own.</p>
        ) : (
          <ol className="ctl-steps">
            {steps.map((text, i) => (
              <li key={i} className="ctl-step">
                <span className="ctl-step-num">{i + 1}</span>
                <input
                  className="ctl-input"
                  value={text}
                  placeholder="Describe this step"
                  aria-label={`Step ${i + 1}`}
                  onChange={(e) => updateStep(i, e.target.value)}
                />
                <button
                  type="button"
                  className="ctl-icon-btn"
                  onClick={() => removeStep(i)}
                  aria-label={`Remove step ${i + 1}`}
                  title="Remove this step"
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        <button type="button" className="ctl-link-btn" onClick={addStep}>
          + Add a step
        </button>
      </div>

      <div className="ctl-settings">
        <label className="ctl-field">
          <span className="ctl-label">Minutes</span>
          <input
            className="ctl-input ctl-minutes"
            type="number"
            min="1"
            max="240"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <label className="ctl-toggle">
          <input type="checkbox" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} />
          <span className="ctl-switch" aria-hidden="true" />
          <span>
            <strong>Demo mode</strong>
            <span className="ctl-muted ctl-small"> — nudges after seconds instead of minutes</span>
          </span>
        </label>
      </div>

      <button type="submit" className="ctl-cta" disabled={!canStart}>
        <span>Start session</span>
        <Arrow />
      </button>
      {!minutesOk && <p className="ctl-muted ctl-small">Minutes must be between 1 and 240.</p>}
    </form>
  );
}

// ---------- 2. Studying ----------
// All the session buttons live here, because the desk view is a projection
// and can't be clicked.

const REENTRY_SHOW_MS = 8000;

function StudyingView({ data, connected, send, onEnd }) {
  const steps = data.steps ?? [];
  const doneCount = steps.filter((s) => s.done).length;
  const onBreak = data.status === "break";
  const allDone = steps.length > 0 && data.current_step === -1;
  const nudge = data.active_nudge;
  const time = useSessionTime(data); // same "40 min left" as the desk

  // Same welcome-back message the desk shows, for 8 seconds.
  const [reentry, setReentry] = useState(null);
  useEffect(() => {
    let timer;
    const stop = onMessage((message) => {
      if (message.type !== "reentry") return;
      setReentry(message.data?.message ?? "Welcome back!");
      clearTimeout(timer);
      timer = setTimeout(() => setReentry(null), REENTRY_SHOW_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="ctl-studying">
      {nudge && (
        <div className="ctl-nudge" role="alert">
          <p className="ctl-nudge-text">{nudge.message}</p>
          <div className="ctl-nudge-buttons">
            <button
              type="button"
              className="ctl-cta ctl-cta-small"
              disabled={!connected}
              onClick={() => send("dismiss", { nudge_id: nudge.id })}
            >
              <span>Back to work</span>
              <Arrow />
            </button>
            <button type="button" className="ctl-btn ctl-btn-quiet" disabled={!connected} onClick={() => send("break")}>
              Break
            </button>
            <button
              type="button"
              className="ctl-btn ctl-btn-quiet"
              disabled={!connected}
              onClick={() => send("relevant", { nudge_id: nudge.id })}
            >
              This is relevant
            </button>
          </div>
        </div>
      )}

      {reentry && !nudge && <p className="ctl-reentry">{reentry}</p>}

      <p className="ctl-status">
        <span className={`ctl-dot ${onBreak ? "ctl-dot-break" : ""}`} aria-hidden="true" />
        {onBreak ? "On a break" : "Studying"}
        {data.demo_mode && <span className="ctl-tag">demo mode</span>}
      </p>
      <h1 className="ctl-goal-title">{data.goal}</h1>
      <div className="ctl-meta">
        <span className="ctl-muted">
          {doneCount} of {steps.length} steps done
        </span>
        <span className="ctl-time-left">
          {time.label}
          {onBreak ? " · paused" : ""}
        </span>
      </div>
      <div className="ctl-progress" aria-hidden="true">
        <div
          className="ctl-progress-fill"
          style={{ width: steps.length ? `${(doneCount / steps.length) * 100}%` : 0 }}
        />
      </div>
      <ol className="ctl-step-status">
        {steps.map((step, i) => (
          <li key={i} className={step.done ? "is-done" : i === data.current_step ? "is-current" : ""}>
            {step.text}
          </li>
        ))}
      </ol>

      {allDone && (
        <div className="ctl-done">
          <p className="ctl-done-title">All {steps.length} steps done. Nice work!</p>
          {(data.parked ?? []).length > 0 ? (
            <>
              <p className="ctl-label">Parked for later — pick what's next</p>
              <ul className="ctl-parked-list">
                {[...data.parked].reverse().map((item, k) => (
                  <li key={`${item.timestamp}-${k}`}>
                    <span>{item.text}</span>
                    <time className="ctl-parked-time">{clock(item.timestamp)}</time>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="ctl-muted ctl-small">Nothing parked. End the session when you're ready.</p>
          )}
        </div>
      )}

      <div className="ctl-actions">
        {onBreak ? (
          <button type="button" className="ctl-cta" disabled={!connected} onClick={() => send("resume")}>
            <span>I'm back</span>
            <Arrow />
          </button>
        ) : (
          !allDone && (
            <button type="button" className="ctl-cta" disabled={!connected} onClick={() => send("step_done")}>
              <span>Step done</span>
              <Arrow />
            </button>
          )
        )}
        {allDone && !onBreak && (
          <button type="button" className="ctl-cta" disabled={!connected} onClick={onEnd}>
            <span>End session &amp; see summary</span>
            <Arrow />
          </button>
        )}
        {!onBreak && !allDone && (
          <button type="button" className="ctl-btn ctl-btn-secondary" disabled={!connected} onClick={() => send("break")}>
            Take a break
          </button>
        )}
      </div>

      <div className="ctl-footer">
        <p className="ctl-muted ctl-small">
          Projector view: <code>localhost:5173/desk</code>, full screen on the projector.
        </p>
        <button type="button" className="ctl-btn ctl-btn-quiet" onClick={onEnd} disabled={!connected}>
          End session <Arrow small />
        </button>
      </div>
    </div>
  );
}

// Parked for later: the park box plus everything parked this session,
// newest first. (The same list shows small on the desk.)
function ParkedCard({ parked, connected, send }) {
  const items = [...(parked ?? [])].reverse();
  return (
    <section className="ctl-card ctl-parked-card" aria-label="Parked for later">
      <p className="ctl-label">
        Parked for later{items.length ? ` · ${items.length}` : ""}
      </p>
      <ParkBox connected={connected} send={send} />
      {items.length === 0 ? (
        <p className="ctl-muted ctl-small ctl-parked-empty">
          Stray thought? Park it here and get back to work. It'll wait for you.
        </p>
      ) : (
        <ul className="ctl-parked-list">
          {items.map((item, k) => (
            <li key={`${item.timestamp}-${k}`}>
              <span>{item.text}</span>
              <time className="ctl-parked-time">{clock(item.timestamp)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// "4:12 PM" from a timestamp, for the parked list.
function clock(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// One-line "park a thought": type it, press Enter, it shows on the desk.
function ParkBox({ connected, send }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  async function park(e) {
    e.preventDefault();
    const thought = text.trim();
    if (!thought) return;
    if (await send("park", { text: thought })) {
      setText("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }
  return (
    <form className="ctl-park" onSubmit={park}>
      <input
        className="ctl-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Park a thought for later…"
        aria-label="Park a thought for later"
      />
      <button type="submit" className="ctl-btn ctl-btn-secondary" disabled={!connected || !text.trim()}>
        {saved ? "Parked ✓" : "Park"}
      </button>
    </form>
  );
}

// ---------- 3. Summary ----------

function SummaryView({ summary, onNewSession }) {
  const stats = [
    { label: "minutes focused", value: summary.minutes_studied },
    { label: "steps done", value: `${summary.steps_done}/${summary.steps_total}` },
    { label: "nudges", value: summary.nudges },
    { label: "breaks", value: summary.breaks },
  ];
  const parked = summary.parked ?? [];

  return (
    <div className="ctl-summary">
      <p className="ctl-status">Session complete</p>
      {summary.note && <h1 className="ctl-goal-title">{summary.note}</h1>}
      <div className="ctl-stats">
        {stats.map((s) => (
          <div key={s.label} className="ctl-stat">
            <span className="ctl-stat-value">{s.value ?? "–"}</span>
            <span className="ctl-stat-label">{s.label}</span>
          </div>
        ))}
      </div>
      {parked.length > 0 && (
        <div className="ctl-section">
          <span className="ctl-label">Parked for later</span>
          <ul className="ctl-parked">
            {parked.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" className="ctl-cta" onClick={onNewSession}>
        <span>Start a new session</span>
        <Arrow />
      </button>
    </div>
  );
}

// ---------- Small icons ----------

// Right arrow in a dark circle, like a "go" pill button.
function Arrow({ small = false }) {
  if (small) {
    return (
      <svg className="ctl-arrow-plain" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <span className="ctl-arrow" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// "Good morning" / "Good afternoon" / "Good evening", from the laptop's clock.
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// ---------- Quote on the desk ----------
// Shows the quote currently projected on the desk. "New quote" picks another at
// random; "Add your own" saves yours and shows it on the desk straight away.

function QuoteCard() {
  const quote = useQuote();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");

  function save(e) {
    e.preventDefault();
    if (addQuote(text, author)) {
      setText("");
      setAuthor("");
      setAdding(false);
    }
  }

  return (
    <section className="ctl-card ctl-quote-card" aria-label="Quote on the desk">
      <p className="ctl-label">Quote on the desk</p>
      <blockquote className="ctl-quote" key={quote.text}>
        <p>“{quote.text}”</p>
        {quote.author && <footer>— {quote.author}</footer>}
      </blockquote>

      {adding ? (
        <form className="ctl-quote-form" onSubmit={save}>
          <textarea
            className="ctl-input ctl-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a quote that keeps you going…"
            aria-label="Your quote"
            rows={3}
            maxLength={160}
            autoFocus
          />
          <input
            className="ctl-input"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Who said it? (optional)"
            aria-label="Who said it"
          />
          <div className="ctl-quote-buttons">
            <button type="submit" className="ctl-btn ctl-btn-primary" disabled={!text.trim()}>
              Save &amp; show
            </button>
            <button type="button" className="ctl-btn ctl-btn-quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="ctl-quote-buttons">
          <button type="button" className="ctl-btn ctl-btn-secondary" onClick={() => nextQuote()}>
            ↻ New quote
          </button>
          <button type="button" className="ctl-btn ctl-btn-quiet" onClick={() => setAdding(true)}>
            + Add your own
          </button>
        </div>
      )}
    </section>
  );
}

// ---------- Header: backend + projector status ----------
// Backend: the live connection to the backend (connection.js).
// Projector: the desk page (localhost:5173/desk) is open in this browser;
// it checks in every 2 seconds (deskSettings.js).

function HeaderStatus({ backendConnected }) {
  const projector = useProjectorConnected();
  return (
    <div className="ctl-status-bar">
      <span className={`ctl-pill ${backendConnected ? "is-on" : ""}`}>
        <span className="ctl-conn" aria-hidden="true" />
        {backendConnected ? "Backend connected" : "Backend offline"}
      </span>
      <span className={`ctl-pill ${projector ? "is-on" : ""}`}>
        <span className="ctl-conn" aria-hidden="true" />
        {projector ? "Projector connected" : "Projector not open"}
      </span>
      <button
        type="button"
        className="ctl-pill ctl-pill-btn"
        onClick={() => {
          const card = document.getElementById("projector-display");
          card?.scrollIntoView({ behavior: "smooth", block: "center" });
          card?.classList.remove("is-flash");
          void card?.offsetWidth; // restart the highlight animation
          card?.classList.add("is-flash");
        }}
      >
        Display settings
      </button>
    </div>
  );
}

// ---------- Projector display settings ----------
// Big, clear choice of desk colours, plus what appears on the desk.
// Changes show on the projector straight away.

const THEMES = [
  { id: "dark", name: "Dark desk", hint: "Glowing lines, light text" },
  { id: "light", name: "Light desk", hint: "Lit panels, dark text" },
];

const SHOW = [
  { key: "showTimer", label: "Timer" },
  { key: "showTree", label: "Tree" },
  { key: "showQuote", label: "Quote" },
];

function ProjectorCard() {
  const settings = useDeskSettings();
  const projector = useProjectorConnected();
  return (
    <section id="projector-display" className="ctl-card ctl-projector" aria-label="Projector display">
      <div className="ctl-projector-head">
        <p className="ctl-projector-title">Projector display</p>
        <span className={`ctl-pill ${projector ? "is-on" : ""}`}>
          <span className="ctl-conn" aria-hidden="true" />
          {projector ? "Connected" : "Not open"}
        </span>
      </div>
      <p className="ctl-muted ctl-small ctl-projector-sub">
        {projector ? "Changes show on the desk right away." : "Open localhost:5173/desk on the projector screen."}
      </p>

      <p className="ctl-label">Desk colour</p>
      <div className="ctl-theme-choices" role="radiogroup" aria-label="Desk colour">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={settings.theme === t.id}
            className={`ctl-theme-choice ${settings.theme === t.id ? "is-on" : ""}`}
            onClick={() => updateDeskSettings({ theme: t.id })}
          >
            <span className={`ctl-theme-swatch ctl-swatch-${t.id}`} aria-hidden="true">
              <span className="ctl-swatch-panel">
                <span className="ctl-swatch-line" />
                <span className="ctl-swatch-line is-short" />
              </span>
            </span>
            <span className="ctl-theme-name">{t.name}</span>
            <span className="ctl-theme-hint">{t.hint}</span>
          </button>
        ))}
      </div>

      <p className="ctl-label">Show on desk</p>
      <div className="ctl-show-row">
        {SHOW.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={settings[key]}
            className={`ctl-chip ${settings[key] ? "is-on" : ""}`}
            onClick={() => updateDeskSettings({ [key]: !settings[key] })}
          >
            <span className="ctl-chip-box" aria-hidden="true">{settings[key] ? "✓" : ""}</span>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- What PLocked sees (moved here from the desk) ----------

const ACTIVITY_WORDS = { relevant: "on task", unrelated: "off task", uncertain: "not sure", unknown: "—" };
const CAMERA_WORDS = { present: "at desk", away: "away", phone_in_hand: "phone in hand", unknown: "off" };

function SeesCard({ activity, camera }) {
  const label = activity?.label ?? "unknown";
  const cam = camera?.state ?? "unknown";
  return (
    <section className="ctl-card ctl-sees" aria-label="What PLocked sees">
      <p className="ctl-label">PLocked sees</p>
      <div className="ctl-sees-row">
        <span className={`ctl-led ctl-led-${label}`} aria-hidden="true" />
        <span className="ctl-sees-name">{activity?.domain ?? "no site yet"}</span>
        <span className="ctl-sees-word">{ACTIVITY_WORDS[label] ?? label}</span>
      </div>
      <div className="ctl-sees-row">
        <span className={`ctl-led ctl-led-cam-${cam}`} aria-hidden="true" />
        <span className="ctl-sees-name">Camera</span>
        <span className="ctl-sees-word">{CAMERA_WORDS[cam] ?? cam}</span>
      </div>
    </section>
  );
}
