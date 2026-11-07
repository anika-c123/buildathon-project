import { useSessionUpdate } from "./useSessionUpdate.js";

// Phase 0 skeleton: shows the goal from the latest session_update.
// The full projector view (timer, steps, nudges, parking lot) is Phase 1, tasks F3-F9.
export default function Desk() {
  const { connected, data } = useSessionUpdate();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#111318",
        color: "#f5f5f5",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
        textAlign: "center",
        gap: "1rem",
      }}
    >
      {!connected && <p>Connecting…</p>}
      {connected && !data && <p>Waiting for the first update…</p>}
      {connected && data && (
        <>
          <p style={{ fontSize: "1.25rem", opacity: 0.7, margin: 0 }}>Goal</p>
          <h1 style={{ fontSize: "3rem", margin: 0 }}>{data.goal ?? "No goal set yet"}</h1>
          <p style={{ opacity: 0.5, margin: 0 }}>status: {data.status}</p>
        </>
      )}
    </div>
  );
}
