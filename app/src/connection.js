// One live connection to the backend, shared by every page.
// See docs/CONTRACT.md section 5 for the session_update shape this listens for.

const WS_URL = "ws://localhost:8000/ws";
const EVENT_URL = "http://localhost:8000/event";
const RECONNECT_DELAY_MS = 1000;

let latestSessionUpdate = null;
let connected = false;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener({ connected, data: latestSessionUpdate });
}

function connect() {
  const socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    connected = true;
    notify();
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "session_update") {
      latestSessionUpdate = message.data;
      notify();
    }
    // Phase 1 will also handle reentry, plan_result, summary, and error here.
  };

  socket.onclose = () => {
    connected = false;
    notify();
    setTimeout(connect, RECONNECT_DELAY_MS);
  };

  socket.onerror = () => socket.close();
}

connect();

// Lets any component read the latest session_update and re-render when it changes.
export function subscribe(listener) {
  listeners.add(listener);
  listener({ connected, data: latestSessionUpdate });
  return () => listeners.delete(listener);
}

// Turns a button press into a user_action message, posted to /event.
export async function sendAction(action, fields = {}) {
  const message = {
    v: 1,
    source: "app",
    type: "user_action",
    data: { action, ...fields },
    timestamp: Date.now(),
  };
  await fetch(EVENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
}
