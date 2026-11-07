import { useEffect, useState } from "react";
import { subscribe } from "./connection.js";

// Re-renders a component with the latest session_update whenever it changes.
export function useSessionUpdate() {
  const [state, setState] = useState({ connected: false, data: null });
  useEffect(() => subscribe(setState), []);
  return state;
}
