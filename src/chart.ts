/**
 * Minimal time-series chart drawn as inline SVG: one dot per solve, with the
 * rolling average over the top. No axes beyond the extremes, because on a
 * phone the shape is the message and the numbers are listed elsewhere.
 */

const W = 320;
const H = 150;
const PAD_L = 34;
const PAD_R = 6;
const PAD_T = 8;
const PAD_B = 16;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function chartSvg(times: number[], average: (number | null)[]): string {
  if (times.length < 2) {
    return `<p class="note center">グラフは2回そろえると出ます</p>`;
  }

  const values = times.concat(average.filter((v): v is number => v !== null));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;

  const x = (i: number) => PAD_L + (i / (times.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - lo) / span) * (H - PAD_T - PAD_B);

  const dots = times
    .map((t, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(t).toFixed(1)}" r="2"/>`)
    .join("");

  // The rolling average only exists once enough solves have accumulated, so
  // the line starts partway across.
  let path = "";
  let started = false;
  average.forEach((v, i) => {
    if (v === null) return;
    path += `${started ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    started = true;
  });

  const label = (v: number, cls: string) =>
    `<text class="${cls}" x="${PAD_L - 5}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`;

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="ソルブタイムの推移、${times.length}回分">
    <line class="axis" x1="${PAD_L}" y1="${y(hi)}" x2="${W - PAD_R}" y2="${y(hi)}"/>
    <line class="axis" x1="${PAD_L}" y1="${y(lo)}" x2="${W - PAD_R}" y2="${y(lo)}"/>
    ${label(hi, "tick")}${label(lo, "tick")}
    <g class="dots">${dots}</g>
    ${path ? `<path class="avg" d="${esc(path)}"/>` : ""}
  </svg>`;
}
