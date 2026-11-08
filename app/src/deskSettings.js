import { useEffect, useState } from "react";
import { onMessage, sendAction } from "./connection.js";

// Projector (desk) display settings, chosen on the laptop, plus a small
// "the projector page is open" signal so the laptop can show its status.
//
// Settings live on the BACKEND (a set_display user_action, broadcast back as
// a display_settings message — see docs/CONTRACT.md), not localStorage: that
// way every open screen — the laptop and the desk view, even on a different
// device on the network — sees the same settings and updates the instant one
// of them changes. (The heartbeat below is a separate, still-localStorage-only
// mechanism — see its own note.)
//
// Settings:
//   theme     "dark"  glowing outlines + light text (dark desks)
//             "light" panels filled with soft light + dark text (light desks;
//                     a projector can't make black, so dark text needs a lit panel)
//   showTimer / showTree / showQuote   what appears on the desk

const HEARTBEAT_KEY = "plocked.deskSeen";
const HEARTBEAT_EVERY_MS = 2000;
const PROJECTOR_TIMEOUT_MS = 6000; // no heartbeat for this long = projector page closed

export const DEFAULT_SETTINGS = { theme: "dark", showTimer: true, showTree: true, showQuote: true };

export function updateDeskSettings(changes) {
  sendAction("set_display", changes);
}

export function useDeskSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  useEffect(
    () =>
      onMessage((message) => {
        if (message.type !== "display_settings") return;
        const theme = message.data?.theme === "light" ? "light" : "dark";
        setSettings((prev) => ({ ...prev, ...message.data, theme }));
      }),
    [],
  );
  return settings;
}

// Called by the desk page: "I'm open", every 2 seconds.
//
// KNOWN GAP: still localStorage-only, so this (and "Projector connected"
// below) only works when the laptop and desk tabs share a browser on the
// same device — unlike the settings above, it does NOT yet detect a desk
// view opened on a separate device. Same underlying fix would apply:
// route it through the backend instead.
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
