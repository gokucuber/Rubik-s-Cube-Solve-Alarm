/**
 * Solve history and the statistics computed from it.
 *
 * Every finished solve is kept, whether or not it met the alarm's time limit:
 * the limit is a rule of the alarm, not a judgement about the solve.
 */

import { tx } from "./store.js";

export interface SolveRecord {
  /** epoch ms when the solve finished */
  at: number;
  seconds: number;
  /** whether it counted toward stopping the alarm */
  accepted: boolean;
  scramble: string;
}

/** Oldest records are dropped past this, so the store cannot grow forever. */
const KEEP = 2000;

let cache: SolveRecord[] | null = null;

export async function loadSolves(): Promise<SolveRecord[]> {
  if (cache) return cache;
  const stored = await tx<SolveRecord[] | undefined>("stats", "readonly", (s) =>
    s.get("solves")
  ).catch(() => undefined);
  cache = stored ?? [];
  return cache;
}

export async function recordSolve(record: SolveRecord) {
  const all = await loadSolves();
  all.push(record);
  if (all.length > KEEP) all.splice(0, all.length - KEEP);
  await tx<void>("stats", "readwrite", (s) => s.put(all, "solves")).catch(() => {});
}

export async function clearSolves() {
  cache = [];
  await tx<void>("stats", "readwrite", (s) => s.delete("solves")).catch(() => {});
}

/**
 * WCA-style average: discard the fastest and slowest, take the mean of the
 * rest. Needs at least `n` solves, counted from the most recent.
 */
export function averageOf(times: number[], n: number): number | null {
  if (times.length < n) return null;
  const window = times.slice(-n).sort((a, b) => a - b).slice(1, -1);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

/** The best average of `n` found anywhere in the history. */
export function bestAverageOf(times: number[], n: number): number | null {
  let best: number | null = null;
  for (let i = 0; i + n <= times.length; i++) {
    const avg = averageOf(times.slice(i, i + n), n);
    if (avg !== null && (best === null || avg < best)) best = avg;
  }
  return best;
}

/** Rolling average of `n` aligned to each solve, for plotting. */
export function rollingAverage(times: number[], n: number): (number | null)[] {
  return times.map((_, i) => (i + 1 >= n ? averageOf(times.slice(i + 1 - n, i + 1), n) : null));
}

export interface Summary {
  count: number;
  best: SolveRecord | null;
  worst: SolveRecord | null;
  mean: number | null;
  ao5: number | null;
  ao12: number | null;
  bestAo5: number | null;
  bestAo12: number | null;
  /** solves finished today, local time */
  today: number;
}

export function summarize(solves: SolveRecord[]): Summary {
  const times = solves.map((s) => s.seconds);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  let best: SolveRecord | null = null;
  let worst: SolveRecord | null = null;
  for (const s of solves) {
    if (!best || s.seconds < best.seconds) best = s;
    if (!worst || s.seconds > worst.seconds) worst = s;
  }

  return {
    count: solves.length,
    best,
    worst,
    mean: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    ao5: averageOf(times, 5),
    ao12: averageOf(times, 12),
    bestAo5: bestAverageOf(times, 5),
    bestAo12: bestAverageOf(times, 12),
    today: solves.filter((s) => s.at >= midnight.getTime()).length,
  };
}
