import { SOLVED, differences, randomScramble, scrambledState } from "./cube.js";
import type { Settings } from "./store.js";

export type Phase =
  /** cube is not solved, so a scramble cannot be applied from a known origin */
  | "needSolved"
  /** scramble shown, waiting for the cube to reach the target state */
  | "scrambling"
  /** scramble applied, waiting for the first turn */
  | "ready"
  /** timer running */
  | "solving"
  /** every requirement met, alarm may stop */
  | "cleared";

export interface Attempt {
  seconds: number;
  accepted: boolean;
}

export class Challenge {
  phase: Phase = "needSolved";
  scramble = "";
  target = SOLVED;
  attempts: Attempt[] = [];
  /** set for one phase change each time a solve finishes */
  lastResult: Attempt | null = null;
  /** facelets still out of place while applying the scramble */
  remaining = 0;
  private startAt = 0;
  private lastMoveAt = 0;
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  get accepted() {
    return this.attempts.filter((a) => a.accepted).length;
  }

  get required() {
    return this.settings.solves;
  }

  get elapsed() {
    if (this.phase !== "solving") return 0;
    return (performance.now() - this.startAt) / 1000;
  }

  get totalAccepted() {
    return this.attempts
      .filter((a) => a.accepted)
      .reduce((sum, a) => sum + a.seconds, 0);
  }

  /** Human-readable statement of what still has to happen. */
  get goal(): string {
    const { solves, limitType, limitSeconds } = this.settings;
    if (limitType === "perSolve")
      return `${limitSeconds}秒以内で ${solves}回`;
    if (limitType === "total")
      return `${solves}回 合計${limitSeconds}秒以内`;
    return `${solves}回`;
  }

  private newScramble() {
    this.scramble = randomScramble(this.settings.scrambleLength);
    this.target = scrambledState(this.scramble);
    this.remaining = differences(SOLVED, this.target);
  }

  /** Call whenever the cube reports a new state. Returns true if the phase changed. */
  onFacelets(facelets: string): boolean {
    const before = this.phase;

    if (this.phase === "needSolved") {
      if (facelets === SOLVED) {
        this.newScramble();
        this.phase = "scrambling";
      }
    } else if (this.phase === "scrambling") {
      this.remaining = differences(facelets, this.target);
      if (this.remaining === 0) this.phase = "ready";
    } else if (this.phase === "ready") {
      // The cube can report the new state before the move event arrives, so
      // treat any departure from the target as the solve having begun.
      if (facelets !== this.target) this.begin(performance.now());
    } else if (this.phase === "solving") {
      if (facelets === SOLVED) this.finishSolve();
    }

    return this.phase !== before;
  }

  /** Call on every move event. Returns true if the phase changed. */
  onMove(at: number): boolean {
    this.lastMoveAt = at;
    if (this.phase === "ready") {
      this.begin(at);
      return true;
    }
    return false;
  }

  private begin(at: number) {
    this.startAt = at;
    this.lastMoveAt = at;
    this.phase = "solving";
  }

  private finishSolve() {
    // Timed from move timestamps rather than packet arrival, so Bluetooth
    // latency does not inflate the result.
    const end = Math.max(this.lastMoveAt, this.startAt);
    const seconds = Math.max(0, (end - this.startAt) / 1000);
    const { limitType, limitSeconds, resetOnFail } = this.settings;

    let accepted = true;
    if (limitType === "perSolve") accepted = seconds <= limitSeconds;
    const attempt: Attempt = { seconds, accepted };
    this.lastResult = attempt;
    this.attempts.push(attempt);

    if (!accepted && resetOnFail) {
      // A miss wipes the streak: the whole set starts again.
      this.attempts = [];
    }

    if (this.accepted >= this.settings.solves) {
      if (limitType === "total" && this.totalAccepted > limitSeconds) {
        // Over the combined budget, so nothing counts.
        this.attempts = [];
      } else {
        this.phase = "cleared";
        return;
      }
    }

    this.newScramble();
    this.phase = "scrambling";
  }

  /** The cube state drifted; force a restart from a solved cube. */
  restart() {
    this.phase = "needSolved";
    this.attempts = [];
  }
}
