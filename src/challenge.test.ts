import { Challenge } from "./challenge.js";
import { SOLVED } from "./cube.js";
import { DEFAULTS, type Settings } from "./store.js";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      expected ${expected}, got ${actual}`);
}

/** Drive one whole solve of the given duration through the machine. */
function solve(c: Challenge, seconds: number) {
  c.onFacelets(c.target); // scramble applied
  c.onMove(0); // first turn starts the timer
  c.onMove(seconds * 1000); // last turn
  c.onFacelets(SOLVED);
}

function start(patch: Partial<Settings>) {
  const c = new Challenge({ ...DEFAULTS, ...patch });
  c.onFacelets(SOLVED); // cube is solved, so a scramble is issued
  return c;
}

// --- plain count mode -------------------------------------------------
{
  const c = start({ solves: 3, limitType: "none" });
  check("count mode starts by scrambling", c.phase, "scrambling");
  solve(c, 12);
  check("one solve done", c.accepted, 1);
  check("a new scramble is issued", c.phase, "scrambling");
  solve(c, 9);
  solve(c, 30);
  check("slow solves still count without a limit", c.accepted, 3);
  check("count mode clears", c.phase, "cleared");
}

// --- per-solve limit, streak resets on a miss -------------------------
{
  const c = start({ solves: 3, limitType: "perSolve", limitSeconds: 15, resetOnFail: true });
  solve(c, 10);
  solve(c, 11);
  check("two banked", c.accepted, 2);
  solve(c, 18); // over the limit
  check("a miss wipes the streak", c.accepted, 0);
  check("still ringing after the miss", c.phase, "scrambling");
  solve(c, 9);
  solve(c, 9);
  solve(c, 9);
  check("three clean solves clear it", c.phase, "cleared");
}

// --- per-solve limit, a miss only costs that attempt ------------------
{
  const c = start({ solves: 2, limitType: "perSolve", limitSeconds: 15, resetOnFail: false });
  solve(c, 10);
  solve(c, 40);
  check("streak survives a miss when resetOnFail is off", c.accepted, 1);
  solve(c, 10);
  check("clears after the retry", c.phase, "cleared");
}

// --- total time budget ------------------------------------------------
{
  const c = start({ solves: 3, limitType: "total", limitSeconds: 45 });
  solve(c, 20);
  solve(c, 20);
  solve(c, 20); // 60s total, over budget
  check("over the total budget resets everything", c.accepted, 0);
  check("still ringing", c.phase, "scrambling");
  solve(c, 14);
  solve(c, 14);
  solve(c, 14); // 42s total
  check("under the total budget clears", c.phase, "cleared");
}

// --- a cube that is not solved cannot be scrambled --------------------
{
  const c = new Challenge({ ...DEFAULTS });
  c.onFacelets("UUFUUFLLFUUURRRRRRFFRFFDFFDRRBDDBDDBLLDLLDLLDLBBUBBUBB");
  check("unsolved cube waits", c.phase, "needSolved");
  c.onFacelets(SOLVED);
  check("solving it first moves on", c.phase, "scrambling");
}

// --- the timer starts even if the state event beats the move event ----
{
  const c = start({ solves: 1, limitType: "none" });
  c.onFacelets(c.target);
  check("scramble recognised", c.phase, "ready");
  c.onFacelets(SOLVED); // a turn landed, state event arrived first
  check("state change alone starts the timer", c.phase, "solving");
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
