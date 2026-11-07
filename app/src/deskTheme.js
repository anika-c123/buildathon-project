import { useEffect, useState } from "react";

// Light or dark mode for the desk projection, chosen on the laptop.
//
// "dark"  (default): glowing outlines and light text, for dark desks.
// "light": panels filled with soft light and dark text, for light desks.
//          (A projector can't make black, it can only leave light out, so dark
//          text only shows up inside a lit panel.)
//
// Saved in localStorage, which the laptop and desk tabs share, so flipping the
// switch on the laptop changes the projection straight away. No backend needed.

const KEY = "plocked.deskTheme";
const SAME_TAB_EVENT = "plocked:deskTheme";

function read() {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function setDeskTheme(theme) {
  try {
    localStorage.setItem(KEY, theme === "light" ? "light" : "dark");
  } catch {
    // ignore: the choice just won't be remembered
  }
  window.dispatchEvent(new Event(SAME_TAB_EVENT));
}

export function useDeskTheme() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const refresh = () => setTheme(read());
    window.addEventListener("storage", refresh); // changed in the other tab
    window.addEventListener(SAME_TAB_EVENT, refresh); // changed in this tab
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(SAME_TAB_EVENT, refresh);
    };
  }, []);
  return theme;
}
