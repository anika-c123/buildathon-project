import { useSessionUpdate } from "./useSessionUpdate.js";

// Phase 0 skeleton: just proves the connection works and prints what arrives.
// The real control screen (goal box, steps, start/end buttons) is Phase 1, task F2.
export default function Control() {
  const { connected, data } = useSessionUpdate();

  if (!connected) return <p>Connecting…</p>;
  if (!data) return <p>Waiting for the first update…</p>;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
      <h1>PLocked — control screen (skeleton)</h1>
      <p>Goal: {data.goal ?? "none yet"}</p>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
