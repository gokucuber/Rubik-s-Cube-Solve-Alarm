import { Challenge } from "./challenge.js";
import { SOLVED, applyMove } from "./cube.js";
import { ScrambleTracker, invert, simplify } from "./scramble.js";
import { DEFAULTS, type Settings } from "./store.js";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * Stand-in for the physical cube: it only ever reports quarter turns, just
 * like the real one, so a scramble's "R2" arrives as two separate "R" turns.
 */
class FakeCube {
  state = SOLVED;
  clock = 0;
  constructor(private sink: (s: string, m: string | null, at: number) => void) {}
  turn(seq: string, msEach = 100) {
    for (const t of seq.trim().split(/\s+/).filter(Boolean)) {
      const q = t.endsWith("2") ? [t[0], t[0]] : [t];
      for (const m of q) {
        this.clock += msEach;
        this.state = applyMove(this.state, m);
        this.sink(this.state, m, this.clock);
      }
    }
  }
  resync() {
    this.sink(this.state, null, this.clock);
  }
}

const inverseOf = (seq: string) => invert(seq.split(" ")).join(" ");

function setup(patch: Partial<Settings>) {
  const c = new Challenge({ ...DEFAULTS, ...patch });
  const cube = new FakeCube((s, m, at) => c.onState(s, m, at));
  cube.resync(); // first full report: solved, so a scramble is issued
  return { c, cube };
}

/** Apply the current scramble, then solve it taking `seconds`. */
function doSolve(c: Challenge, cube: FakeCube, seconds: number) {
  cube.turn(c.scramble, 50);
  const solution = inverseOf(c.scramble);
  const quarterCount = solution.split(" ").reduce((n, m) => n + (m.endsWith("2") ? 2 : 1), 0);
  cube.turn(solution, (seconds * 1000) / (quarterCount - 1));
}

// --- simplify / invert ------------------------------------------------
check("R R becomes R2", simplify(["R", "R"]), ["R2"]);
check("R R' cancels", simplify(["R", "R'"]), []);
check("R R R becomes R'", simplify(["R", "R", "R"]), ["R'"]);
check("different faces are kept", simplify(["R", "U", "R"]), ["R", "U", "R"]);
check("inverse reverses and flips", invert(["R", "U2", "F'"]), ["F", "U2", "R'"]);

// --- tracker: progress along a scramble --------------------------------
{
  const t = new ScrambleTracker("R U2 F'");
  let s = SOLVED;
  const step = (m: string) => (s = applyMove(s, m));
  step("R");
  check("one move done", t.update(s, "R"), { done: 1, half: false, onTrack: true, fix: [], lost: false });
  step("U");
  check("halfway through U2", t.update(s, "U"), { done: 1, half: true, onTrack: true, fix: [], lost: false });
  step("U");
  check("U2 complete", t.update(s, "U").done, 2);
}
{
  const t = new ScrambleTracker("R U2 F'");
  let s = applyMove(SOLVED, "R");
  t.update(s, "R");
  s = applyMove(s, "U'");
  check("U2 done counter-clockwise also counts as halfway", t.update(s, "U'").half, true);
  s = applyMove(s, "U'");
  check("and completes", t.update(s, "U'").done, 2);
}

// --- tracker: wrong turns ----------------------------------------------
{
  const t = new ScrambleTracker("R U F");
  let s = applyMove(SOLVED, "R");
  t.update(s, "R");
  s = applyMove(s, "L"); // wrong face
  const p = t.update(s, "L");
  check("wrong turn is flagged", p.onTrack, false);
  check("fix undoes it", p.fix, ["L'"]);
  check("progress is remembered", p.done, 1);
  s = applyMove(s, "L'");
  check("undoing it puts us back on track", t.update(s, "L'"), { done: 1, half: false, onTrack: true, fix: [], lost: false });
}
{
  const t = new ScrambleTracker("R U F");
  let s = applyMove(SOLVED, "R");
  t.update(s, "R");
  s = applyMove(s, "U'"); // right face, wrong direction
  check("wrong direction: fix is two turns merged", t.update(s, "U'").fix, ["U"]);
}
{
  const t = new ScrambleTracker("R U F");
  let s = applyMove(SOLVED, "R");
  t.update(s, "R");
  for (const m of ["L", "D", "B"]) {
    s = applyMove(s, m);
    t.update(s, m);
  }
  check("several wrong turns: undo in reverse", t.progress.fix, ["B'", "D'", "L'"]);
}
{
  const t = new ScrambleTracker("R U F");
  let s = applyMove(SOLVED, "R");
  t.update(s, "R");
  for (const m of ["L", "D", "B", "L", "D", "B", "L"]) {
    s = applyMove(s, m);
    t.update(s, m);
  }
  check("too far off: gives up on the fix", t.progress.lost, true);
}
{
  const t = new ScrambleTracker("R U F");
  const s = applyMove(applyMove(SOLVED, "R"), "L");
  check("off track after a resync: path unknown", t.update(s, null).lost, true);
}
{
  const t = new ScrambleTracker("R U F");
  let s = applyMove(SOLVED, "R");
  t.update(s, "R");
  s = applyMove(s, "L");
  t.update(s, "L");
  check("solving the cube returns to move zero", t.update(SOLVED, null).done, 0);
}

// --- challenge: modes --------------------------------------------------
{
  const { c, cube } = setup({ solves: 3, limitType: "none" });
  check("count mode starts by scrambling", c.phase, "scrambling");
  doSolve(c, cube, 12);
  check("one solve banked", c.accepted, 1);
  check("a new scramble follows", c.phase, "scrambling");
  doSolve(c, cube, 9);
  doSolve(c, cube, 30);
  check("slow solves count without a limit", c.phase, "cleared");
}
{
  const { c, cube } = setup({ solves: 3, limitType: "perSolve", limitSeconds: 15, resetOnFail: true });
  doSolve(c, cube, 10);
  doSolve(c, cube, 11);
  doSolve(c, cube, 18);
  check("a miss wipes the streak", c.accepted, 0);
  doSolve(c, cube, 9);
  doSolve(c, cube, 9);
  doSolve(c, cube, 9);
  check("three clean solves clear it", c.phase, "cleared");
}
{
  const { c, cube } = setup({ solves: 2, limitType: "perSolve", limitSeconds: 15, resetOnFail: false });
  doSolve(c, cube, 10);
  doSolve(c, cube, 40);
  check("without reset, a miss only costs that attempt", c.accepted, 1);
  doSolve(c, cube, 10);
  check("clears after the retry", c.phase, "cleared");
}
{
  const { c, cube } = setup({ solves: 3, limitType: "total", limitSeconds: 45 });
  doSolve(c, cube, 20);
  doSolve(c, cube, 20);
  doSolve(c, cube, 20);
  check("over the total budget resets", c.accepted, 0);
  doSolve(c, cube, 14);
  doSolve(c, cube, 14);
  doSolve(c, cube, 14);
  check("under the total budget clears", c.phase, "cleared");
}

// --- challenge: timing and flow ----------------------------------------
{
  const { c, cube } = setup({ solves: 1, limitType: "none" });
  doSolve(c, cube, 8.5);
  check("time is measured from first to last solving turn", c.attempts[0]?.seconds.toFixed(2) ?? "none", "8.50");
}
{
  const { c, cube } = setup({ solves: 1 });
  cube.turn(c.scramble);
  check("scramble applied: waiting for first turn", c.phase, "ready");
  cube.turn("R");
  check("first turn starts the timer", c.phase, "solving");
}
{
  const c = new Challenge({ ...DEFAULTS });
  const cube = new FakeCube((s, m, at) => c.onState(s, m, at));
  cube.turn("R U F");
  cube.resync();
  check("unsolved cube waits", c.phase, "needSolved");
  cube.turn("F' U' R'");
  check("solving it first moves on", c.phase, "scrambling");
}
{
  const { c, cube } = setup({ solves: 1 });
  const [first, second] = c.scramble.split(" ");
  // A face that is neither this move nor the next, so it cannot be progress.
  const wrong = "URFDLB".split("").find((f) => f !== first[0] && f !== second[0])!;
  cube.turn(first);
  cube.turn(wrong);
  check("mid-scramble mistake is flagged", c.progress?.onTrack, false);
  cube.turn(invert([wrong])[0]);
  check("after undoing, back on track", c.progress?.onTrack, true);
  cube.turn(c.scramble.split(" ").slice(1).join(" "));
  check("and the scramble can be finished", c.phase, "ready");
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
