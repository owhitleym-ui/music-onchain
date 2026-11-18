// Views chart, adapted from TJ's `renderChart` (frontend/chart.js): same smooth line, grid,
// shaded "future" area and classes. Changes for the contract's rules:
//   - one future point (entries close / result time) instead of three prediction windows
//   - it plots TOTAL views, because the contract's metric is "YouTube views at close"
//   - optional markers for the crowd's average guess, your guess, and the final result
// The history line is SAMPLE data (lib/client/history.ts); guesses and the result are real.
import type { HistoryPoint } from "@/lib/client/history";

const BLUE = "#3974e6";
const GREEN = "#168465";
const ORANGE = "#c7865b";

/** Monotone cubic smoothing from TJ's chart, so the line never overshoots between points. */
function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return "";
  const slopes = points.slice(1).map((p, i) => (p.y - points[i].y) / (p.x - points[i].x));
  const tangents = [slopes[0]];
  for (let i = 1; i < points.length - 1; i++) {
    tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i]));
  }
  tangents.push(slopes.at(-1)!);
  return points.slice(1).reduce((path, end, i) => {
    const start = points[i];
    const dx = (end.x - start.x) / 3;
    return `${path} C ${start.x + dx},${start.y + tangents[i] * dx} ${end.x - dx},${end.y - tangents[i + 1] * dx} ${end.x},${end.y}`;
  }, `M ${points[0].x},${points[0].y}`);
}

const compact = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const date = (t: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }).format(t * 1000);

export function ViewsChart(props: {
  history: HistoryPoint[];
  closesAt: number;
  crowdAverage: number | null;
  yourGuess: number | null;
  finalMetric: number | null;
}) {
  const { history, closesAt, crowdAverage, yourGuess, finalMetric } = props;
  const width = 840;
  const height = 380;
  const left = 66;
  const right = 805;
  const top = 36;
  const bottom = 299;

  const first = history[0].time;
  const now = history.at(-1)!.time;
  // Give the future a fixed 18% of the width so a 15-minute demo window is still visible.
  const span = now - first;
  const futureX = (right - left) * 0.82 + left;
  const x = (t: number) => (t <= now ? left + ((t - first) / span) * (futureX - left) : futureX + ((right - futureX) * Math.min(1, (t - now) / Math.max(1, closesAt - now))));

  const markers = [crowdAverage, yourGuess, finalMetric].filter((v): v is number => v !== null);
  const values = [...history.map((p) => p.views), ...markers];
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const step = Math.max(1000, Math.ceil((highest - lowest || highest / 3) / 4000) * 1000);
  const min = Math.max(0, Math.floor(lowest / step - 1) * step);
  const max = Math.ceil(highest / step + 1) * step;
  const y = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top);

  const points = history.map((p) => ({ x: x(p.time), y: y(p.views) }));
  const last = points.at(-1)!;
  const closeX = right - 8;
  const grids = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);

  const marker = (value: number | null, color: string, label: string, dashed: boolean) =>
    value === null ? null : (
      <g key={label}>
        <line x1={last.x} y1={last.y} x2={closeX} y2={y(value)} stroke={color} strokeOpacity=".7" strokeWidth="2" strokeDasharray={dashed ? "6 6" : undefined} />
        <circle cx={closeX} cy={y(value)} r="5.5" fill="var(--surface)" stroke={color} strokeWidth="2.5">
          <title>{`${label}: ${value.toLocaleString("en-US")} views`}</title>
        </circle>
        <text x={closeX - 12} y={y(value) - 10} textAnchor="end" className="chart-value" fill={color}>
          {label} {compact(value)}
        </text>
      </g>
    );

  return (
    <svg className="views-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Total video views (sample history) with the crowd's average guess, your guess, and the final result.">
      <rect x={futureX} y={top} width={right - futureX} height={bottom - top} rx="3" className="chart-future" />
      {grids.map((v) => (
        <g key={v}>
          <line x1={left} x2={right} y1={y(v)} y2={y(v)} className="chart-grid" />
          <text x={left - 13} y={y(v) + 4} textAnchor="end" className="chart-axis">
            {compact(v)}
          </text>
        </g>
      ))}
      <line x1={futureX} x2={futureX} y1={top} y2={bottom} className="chart-now-line" />
      <text x={futureX + 12} y={top - 13} className="chart-axis">
        Predictions
      </text>
      <path d={smoothPath(points)} fill="none" stroke={BLUE} strokeWidth="3" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r="4" fill={BLUE} />
      {marker(crowdAverage, BLUE, "Crowd", true)}
      {marker(yourGuess, ORANGE, "You", true)}
      {marker(finalMetric, GREEN, "Result", false)}
      {[history[0], history[Math.floor((history.length - 1) / 2)]].map((p) => (
        <text key={p.time} x={x(p.time)} y={bottom + 27} textAnchor="middle" className="chart-axis">
          {date(p.time)}
        </text>
      ))}
      <text x={futureX} y={bottom + 27} textAnchor="middle" className="chart-axis">
        Now
      </text>
      <text x={right} y={bottom + 27} textAnchor="end" className="chart-axis">
        Close
      </text>
    </svg>
  );
}
