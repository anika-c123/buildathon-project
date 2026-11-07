import { useEffect, useRef, useState } from "react";
import { useSessionUpdate } from "./useSessionUpdate.js";
import { onMessage, sendAction } from "./connection.js";
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
          <LockMark />
          <span className="ctl-logo">PLocked</span>
        </span>
        <span className="ctl-subtitle">
          <span className={`ctl-conn ${connected ? "is-on" : ""}`} aria-hidden="true" />
          {connected ? "Connected" : "Offline"}
        </span>
      </header>
      <main className="ctl-card">
        {notice && (
          <p className="ctl-notice" role="alert">
            {notice}
          </p>
        )}
        {view}
      </main>
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
          What do you want to get done?
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
      <p className="ctl-muted">
        {doneCount} of {steps.length} steps done
      </p>
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
        {!onBreak && (
          <button type="button" className="ctl-btn ctl-btn-secondary" disabled={!connected} onClick={() => send("break")}>
            Take a break
          </button>
        )}
      </div>

      <ParkBox connected={connected} send={send} />

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

// A small rounded padlock: PLocked's own mark.
function LockMark() {
  return (
    <svg className="ctl-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="4" y="10" width="16" height="11.5" rx="4" fill="currentColor" />
      <circle cx="12" cy="15.6" r="1.7" fill="#fbfcf5" />
    </svg>
  );
}
