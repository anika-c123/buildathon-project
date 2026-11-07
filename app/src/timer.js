import { useEffect, useRef, useState } from "react";

// Session time, shared by the desk view and the laptop so both always agree.
//
// "Time left" counts focused time only: the clock pauses during a break
// (CLAUDE.md: "the timer runs inside the app"), so break time is measured here.
// The minutes shown move in calm steps (60 → 50 → 40 …), not every minute.

// Re-renders every second so bars and labels stay current.
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Time spent on breaks this session. Resets when a new session starts.
// If the page is reloaded mid-session, earlier breaks aren't counted (fine for a demo).
function useBreakTime(data) {
  const total = useRef(0);
  const breakStart = useRef(null);
  const session = useRef(null);
  const [, force] = useState(0);

  const startedAt = data?.started_at ?? null;
  const onBreak = data?.status === "break";

  useEffect(() => {
    if (startedAt !== session.current) {
      session.current = startedAt;
      total.current = 0;
      breakStart.current = null;
    }
    if (onBreak && breakStart.current === null) {
      breakStart.current = Date.now();
      force((n) => n + 1);
    } else if (!onBreak && breakStart.current !== null) {
      total.current += Date.now() - breakStart.current;
      breakStart.current = null;
      force((n) => n + 1);
    }
  }, [startedAt, onBreak]);

  return (now) => total.current + (breakStart.current !== null ? now - breakStart.current : 0);
}

// { totalMs, remainingMs, fraction (1 = full, 0 = out of time), label: "40 min left" }
export function useSessionTime(data) {
  const now = useNow();
  const breakTime = useBreakTime(data);
  const totalMs = Math.max(1, (data?.ends_at ?? 0) - (data?.started_at ?? 0));
  const focusedMs = data?.started_at ? Math.max(0, now - data.started_at - breakTime(now)) : 0;
  const remainingMs = Math.max(0, totalMs - focusedMs);
  return {
    now,
    totalMs,
    remainingMs,
    focusedMs, // time actually spent focusing (breaks not counted)
    fraction: Math.min(1, remainingMs / totalMs),
    label: minutesLeftLabel(remainingMs, totalMs),
  };
}

// Rounds the time left UP to a calm step, so it reads 60, 50, 40 … 10, then 0.
// Over an hour it reads like "1 h 30 min left".
// Step size depends on the session length, so short demo sessions still move:
// 30 min or longer → 10-minute steps, 10–29 min → 5-minute steps, shorter → 1 minute.
export function minutesLeftLabel(remainingMs, totalMs) {
  const totalMin = totalMs / 60000;
  const step = totalMin >= 30 ? 10 : totalMin >= 10 ? 5 : 1;
  const minutes = remainingMs <= 0 ? 0 : Math.min(Math.round(totalMin), Math.ceil(remainingMs / 60000 / step) * step);
  if (minutes > 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} h${m ? ` ${m} min` : ""} left`;
  }
  return `${minutes} min left`;
}
