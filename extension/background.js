// PLocked Chrome extension (Brain, B9) — reports which site is open.
//
// In plain English: this background script watches which browser tab is
// active and sends its site name (never the full web address) and title
// to the backend, but only while a study session is actually running. It
// checks the backend every 5 seconds to find that out. See
// docs/CONTRACT.md §4 for the exact message shape this follows.

const BACKEND_URL = "http://localhost:8000";
const POLL_MS = 5000;
const DEBOUNCE_MS = 250; // waits a beat so a page load's several title changes become one message

let sessionLive = false; // true while the backend says "studying" or "break"
let focusedWindowId = chrome.windows.WINDOW_ID_NONE;
let debounceTimer = null;

// The site name only — e.g. "docs.oracle.com" — never the full address.
function domainOf(url) {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null; // chrome://, about:, a blank new tab, etc. — nothing to report
  }
}

function send(data) {
  const message = {
    v: 1,
    source: "extension",
    type: "tab_change",
    data,
    timestamp: Date.now(),
  };
  fetch(`${BACKEND_URL}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  }).catch(() => {
    // Backend's probably not running right now — nothing to do but try again next time.
  });
}

async function reportNow() {
  if (!sessionLive) return;

  if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) {
    send({ domain: null, title: null, focused: false });
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWindowId });
    if (!tab) {
      send({ domain: null, title: null, focused: false });
      return;
    }
    send({ domain: domainOf(tab.url || ""), title: tab.title || null, focused: true });
  } catch {
    send({ domain: null, title: null, focused: false }); // the window probably just closed
  }
}

function reportSoon() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(reportNow, DEBOUNCE_MS);
}

chrome.windows.onFocusChanged.addListener((windowId) => {
  focusedWindowId = windowId; // WINDOW_ID_NONE means the user switched to a different app entirely
  reportSoon();
});

chrome.tabs.onActivated.addListener(() => {
  reportSoon();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.title !== undefined || changeInfo.url !== undefined) {
    reportSoon();
  }
});

async function pollSessionStatus() {
  let live = false;
  try {
    const response = await fetch(`${BACKEND_URL}/state`);
    const state = await response.json();
    live = state.status === "studying" || state.status === "break";
  } catch {
    live = false; // backend is down — stay quiet
  }

  const justStarted = live && !sessionLive;
  sessionLive = live;
  if (justStarted) {
    // A session just started (or we just noticed it): report what's active
    // right now, instead of waiting for the next tab switch.
    reportSoon();
  }
}

// WINDOW_ID_NONE is only known once we ask, so find out right away on load.
chrome.windows.getLastFocused().then((win) => {
  focusedWindowId = win.focused ? win.id : chrome.windows.WINDOW_ID_NONE;
});

// Note: Chrome can put this service worker to sleep after ~30s with nothing
// to do. During an actual study session there's a steady stream of tab
// events keeping it awake, so this hasn't needed anything fancier — if
// polling ever seems to stop after a long idle stretch, switch this to the
// chrome.alarms API instead of setInterval.
pollSessionStatus();
setInterval(pollSessionStatus, POLL_MS);
