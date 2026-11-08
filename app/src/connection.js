// One live connection to the backend, shared by every page.
// The rules for every message live in docs/CONTRACT.md (sections 3-5).
//
// In plain English:
// - We open a WebSocket (a connection that stays open so the backend can
//   push updates the instant something changes) to the backend on port 8000.
// - The backend always runs on the laptop, on whatever address this page
//   itself was opened with (window.location.hostname) — so this works the
//   same whether you open localhost:5173 on the laptop, or the laptop's
//   network address from a different device, with no hardcoded address.
// - Every time the backend sends a session_update, we keep the newest one
//   and tell every screen to redraw.
// - If the connection drops (backend restarted, laptop asleep), we wait a
//   moment and try again, forever, until it comes back.
// - Button presses become user_action messages, POSTed to /event.

const BACKEND_HOST = `${window.location.hostname}:8000`;
const WS_URL = `ws://${BACKEND_HOST}/ws`;
const EVENT_URL = `http://${BACKEND_HOST}/event`;
const FIRST_RETRY_MS = 1000; // wait 1 s before the first retry...
const MAX_RETRY_MS = 5000; // ...then a little longer each time, up to 5 s

let latestSessionUpdate = null;
let connected = false;
let retryMs = FIRST_RETRY_MS;
const listeners = new Set();

// The newest message of every other type the backend sends
// (reentry, plan_result, summary, error), so screens can show them.
const latestByType = {};
const typeListeners = new Set();

function notify() {
  for (const listener of listeners) listener({ connected, data: latestSessionUpdate });
}

function handleMessage(message) {
  if (!message || typeof message !== "object" || !message.type) return;

  if (message.type === "session_update") {
    latestSessionUpdate = message.data;
    notify();
    return;
  }

  // Contract section 7: ignore types we don't know, so new ones never break us.
  latestByType[message.type] = message;
  for (const listener of typeListeners) listener(message);
}

function connect() {
  const socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    connected = true;
    retryMs = FIRST_RETRY_MS;
    notify();
  };

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      console.warn("[connection] ignored a message that wasn't valid JSON");
      return;
    }
    handleMessage(message);
  };

  // When the connection drops or fails, schedule ONE retry. Browsers fire
  // "error" then "close"; some environments fire only "error". Either one
  // starts the retry, and the guard makes sure it only happens once.
  let retryScheduled = false;
  function retry() {
    if (retryScheduled) return;
    retryScheduled = true;
    const wasConnected = connected;
    connected = false;
    if (wasConnected) notify();
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  }

  socket.onclose = retry;
  // Don't call socket.close() in here: closing an already-failed socket can
  // fire another error, which loops forever.
  socket.onerror = retry;
}

connect();

// Lets any component read the latest session_update and redraw when it changes.
// Returns a function that stops listening.
export function subscribe(listener) {
  listeners.add(listener);
  listener({ connected, data: latestSessionUpdate });
  return () => listeners.delete(listener);
}

// Lets a component react to other messages (reentry, plan_result, summary, error).
// The listener gets the whole message: { v, source, type, data, timestamp }.
export function onMessage(listener) {
  typeListeners.add(listener);
  return () => typeListeners.delete(listener);
}

// The newest message of a given type, or undefined if none has arrived yet.
export function latestMessage(type) {
  return latestByType[type];
}

// Turns a button press into a user_action message, posted to /event.
// Example: sendAction("park", { text: "Email my TA" })
// Returns { ok: true } on success, or { ok: false, error } if the backend
// is off or rejected the message, so a button press never crashes the page.
export async function sendAction(action, fields = {}) {
  const message = {
    v: 1,
    source: "app",
    type: "user_action",
    data: { action, ...fields },
    timestamp: Date.now(),
  };
  try {
    const response = await fetch(EVENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      const error = `backend said ${response.status}`;
      console.warn(`[connection] ${action} not accepted: ${error}`);
      return { ok: false, error };
    }
    return { ok: true };
  } catch {
    console.warn(`[connection] ${action} not sent: backend is not running`);
    return { ok: false, error: "backend is not running" };
  }
}
