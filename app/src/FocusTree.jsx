// The focus tree on the desk: a little outlined tree that grows the longer you
// stay focused, and grows a glossy marble for every step you finish (big) and
// for every 10 focused minutes (small). Break time doesn't count.
//
// Drawn as outlines so it projects well. It sways very slowly so it feels
// alive without pulling attention away from the work.

const MAX_MARBLES = 12;

// Where marbles hang, relative to the middle of the leaves (at full size).
const SLOTS = [
  [-20, 8], [18, 10], [0, -14], [-34, 22], [32, 24], [-8, 26],
  [14, -30], [-22, -24], [40, 2], [-42, 0], [4, 10], [26, -12],
];

// The leafy blobs, in the order they appear as the tree grows.
const BLOBS = [
  [0, 0, 34], [-28, 14, 26], [28, 14, 26], [-16, -20, 22], [16, -20, 22],
];

export default function FocusTree({ focusedMs, stepsDone, stepsTotal }) {
  const focusedMin = Math.max(0, focusedMs / 60000);
  const stepsFrac = stepsTotal ? stepsDone / stepsTotal : 0;
  // 0 = sapling, 1 = full tree. Mostly from focus time, partly from steps done.
  const g = Math.min(1, 0.15 + 0.55 * Math.min(1, focusedMin / 45) + 0.3 * stepsFrac);

  const big = Math.min(stepsDone, MAX_MARBLES);
  const small = Math.min(Math.floor(focusedMin / 10), MAX_MARBLES - big);
  const marbles = [...Array(big).fill("big"), ...Array(small).fill("small")];

  const groundY = 205;
  const height = 50 + 60 * g; // trunk height
  const topY = groundY - height;
  const s = 0.55 + 0.45 * g; // leaf size
  const cx = 100;
  const cy = topY - 10 * s;
  const blobCount = 1 + Math.floor(g * 4.99);

  return (
    <div className="dsk-tree">
      {/* The view is cropped to where the tree actually grows, so it fills its space. */}
      <svg viewBox="38 34 124 184" preserveAspectRatio="xMidYMax meet" role="img" aria-label={`Focus tree with ${marbles.length} marbles`}>
        <defs>
          <linearGradient id="tree-leaf" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--tree-leaf-a)" />
            <stop offset="100%" stopColor="var(--tree-leaf-b)" />
          </linearGradient>
          <radialGradient id="tree-marble" cx="32%" cy="28%" r="75%">
            <stop offset="0%" stopColor="#fff1e8" />
            <stop offset="25%" stopColor="#ffbf9f" />
            <stop offset="55%" stopColor="#f2876f" />
            <stop offset="85%" stopColor="#c9567a" />
            <stop offset="100%" stopColor="#8e5aa6" />
          </radialGradient>
        </defs>

        {/* ground */}
        <path d={`M40 ${groundY} Q100 ${groundY - 6} 160 ${groundY}`} className="dsk-tree-ground" />

        <g className="dsk-tree-sway">
          {/* trunk + two branches once it's big enough */}
          <path
            d={`M${cx} ${groundY} C${cx - 3} ${groundY - height * 0.4} ${cx + 4} ${groundY - height * 0.7} ${cx} ${topY}`}
            className="dsk-tree-trunk"
          />
          {g > 0.35 && (
            <>
              <path
                d={`M${cx} ${groundY - height * 0.6} Q${cx - 14 * s} ${groundY - height * 0.72} ${cx - 26 * s} ${cy + 16 * s}`}
                className="dsk-tree-branch"
              />
              <path
                d={`M${cx} ${groundY - height * 0.66} Q${cx + 14 * s} ${groundY - height * 0.78} ${cx + 26 * s} ${cy + 16 * s}`}
                className="dsk-tree-branch"
              />
            </>
          )}

          {/* leaves */}
          {BLOBS.slice(0, blobCount).map(([dx, dy, r], k) => (
            <circle key={k} cx={cx + dx * s} cy={cy + dy * s} r={r * s} className="dsk-tree-leaf" />
          ))}

          {/* marbles */}
          {marbles.map((size, k) => {
            const [dx, dy] = SLOTS[k];
            return (
              <circle
                key={k}
                cx={cx + dx * s}
                cy={cy + dy * s}
                r={size === "big" ? 7 : 4.5}
                fill="url(#tree-marble)"
                className="dsk-tree-marble"
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
