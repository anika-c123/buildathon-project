import { useEffect, useState } from "react";

// Inspirational quotes, shared between the laptop and the desk view.
//
// The built-in list lives in public/quotes.txt (one "quote ~ who said it" per line).
// The quote currently on the desk, and any quotes the student adds, are kept in the
// browser's localStorage. The laptop and the desk are two tabs in the same Chrome,
// and the browser tells every open tab when localStorage changes, so pressing
// "New quote" on the laptop updates the projection right away. No backend needed.

const CURRENT_KEY = "plocked.quote";
const CUSTOM_KEY = "plocked.customQuotes";
const SAME_TAB_EVENT = "plocked:quote"; // the browser doesn't notify the tab that made the change

const FALLBACK = { text: "One step at a time is still moving forward.", author: "PLocked" };

let builtIn = null; // loaded once from /quotes.txt

export function parseQuotes(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const at = line.lastIndexOf("~");
      if (at === -1) return { text: line, author: "" };
      return { text: line.slice(0, at).trim(), author: line.slice(at + 1).trim() };
    })
    .filter((q) => q.text);
}

async function loadBuiltIn() {
  if (builtIn) return builtIn;
  try {
    const response = await fetch("/quotes.txt");
    builtIn = parseQuotes(await response.text());
  } catch {
    builtIn = [];
  }
  if (builtIn.length === 0) builtIn = [FALLBACK];
  return builtIn;
}

// localStorage can be missing or blocked in some browsers; never let that crash the page.
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: the quote just won't be remembered
  }
  window.dispatchEvent(new Event(SAME_TAB_EVENT));
}

export function customQuotes() {
  return read(CUSTOM_KEY, []);
}

// Pick a random quote that isn't the one already showing.
export async function nextQuote() {
  const all = [...(await loadBuiltIn()), ...customQuotes()];
  const current = read(CURRENT_KEY, null);
  const choices = all.length > 1 ? all.filter((q) => q.text !== current?.text) : all;
  const pick = choices[Math.floor(Math.random() * choices.length)] ?? FALLBACK;
  write(CURRENT_KEY, pick);
  return pick;
}

// Save the student's own quote and show it on the desk straight away.
export function addQuote(text, author) {
  const quote = { text: text.trim(), author: (author ?? "").trim() || "Me" };
  if (!quote.text) return null;
  write(CUSTOM_KEY, [...customQuotes(), quote]);
  write(CURRENT_KEY, quote);
  return quote;
}

// The quote currently on the desk. Picks a random one the first time.
export function useQuote() {
  const [quote, setQuote] = useState(() => read(CURRENT_KEY, null));

  useEffect(() => {
    const refresh = () => setQuote(read(CURRENT_KEY, null));
    window.addEventListener("storage", refresh); // changes made in the other tab
    window.addEventListener(SAME_TAB_EVENT, refresh); // changes made in this tab
    if (!read(CURRENT_KEY, null)) nextQuote();
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(SAME_TAB_EVENT, refresh);
    };
  }, []);

  return quote ?? FALLBACK;
}
