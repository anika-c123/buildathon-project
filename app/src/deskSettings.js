import { useEffect, useState } from "react";

// Projector (desk) display settings, chosen on the laptop, plus a small
// "the projector page is open" signal so the laptop can show its status.
//
// Both are kept in localStorage, which the laptop tab and the desk tab share
// (same Chrome), and the browser tells each tab when the other changes it.
// No backend needed.
//
// Settings:
//   theme     "dark"  glowing outlines + light text (dark desks)
//             "light" panels filled with soft light + dark text (light desks;
//                     a projector can't make black, so dark text needs a lit panel)
//   showTimer / showTree / showQuote   what appears on the desk

const SETTINGS_KEY = "plocked.deskSettings";
const HEARTBEAT_KEY = "plocked.deskSeen";
const SAME_TAB_EVENT = "plocked:deskSettings";
const HEARTBEAT_EVERY_MS = 2000;
const PROJECTOR_TIMEOUT_MS = 6000; // no heartbeat for this long = projector page closed

export const DEFAULT_SETTINGS = { theme: "dark", showTimer: true, showTree: true, showQuote: true };

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...saved, theme: saved.theme === "light" ? "light" : "dark" };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function updateDeskSettings(changes) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), ...changes }));
  } catch {
    // ignore: the choice just won't be remembered
  }
  window.dispatchEvent(new Event(SAME_TAB_EVENT));
}

export function useDeskSettings() {
  const [settings, setSettings] = useState(readSettings);
  useEffect(() => {
    const refresh = () => setSettings(readSettings());
    window.addEventListener("storage", refresh); // changed in the other tab
    window.addEventListener(SAME_TAB_EVENT, refresh); // changed in this tab
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(SAME_TAB_EVENT, refresh);
    };
  }, []);
  return settings;
}

// Called by the desk page: "I'm open", every 2 seconds.
export function useDeskHeartbeat() {
  useEffect(() => {
    const beat = () => {
      try {
        localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
      } catch {
        // ignore
      }
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_EVERY_MS);
    return () => clearInterval(id);
  }, []);
}

// Used by the laptop: true while the desk page is open in this browser.
export function useProjectorConnected() {
  const check = () => {
    try {
      return Date.now() - Number(localStorage.getItem(HEARTBEAT_KEY) || 0) < PROJECTOR_TIMEOUT_MS;
    } catch {
      return false;
    }
  };
  const [connected, setConnected] = useState(check);
  useEffect(() => {
    const id = setInterval(() => setConnected(check()), 1000);
    return () => clearInterval(id);
  }, []);
  return connected;
}
