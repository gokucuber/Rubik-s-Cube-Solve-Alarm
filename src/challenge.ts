import { SOLVED, randomScramble, scrambledState } from "./cube.js";
import { ScrambleTracker, type Progress } from "./scramble.js";
import type { Settings } from "./store.js";

export type Phase =
  /** cube is not solved, so a scramble cannot be applied from a known origin */
  | "needSolved"
  /** scramble shown, following the cube along it */
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
  /** the scramble this solve started from, kept for the record books */
  scramble: string;
}

export class Challenge {
  phase: Phase = "needSolved";
  scramble = "";
  target = SOLVED;
  tracker: ScrambleTracker | null = null;
  attempts: Attempt[] = [];
  /** set for one phase change each time a solve finishes */
  lastResult: Attempt | null = null;
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

  get progress(): Progress | null {
    return this.tracker?.progress ?? null;
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

  /** Human-readable statement of what has to happen. */
  get goal(): string {
    const { solves, limitType, limitSeconds } = this.settings;
    if (limitType === "perSolve") return `${limitSeconds}秒以内で ${solves}回`;
    if (limitType === "total") return `${solves}回 合計${limitSeconds}秒以内`;
    return `${solves}回`;
  }

  private newScramble() {
    this.scramble = randomScramble(this.settings.scrambleLength);
    this.target = scrambledState(this.scramble);
    this.tracker = new ScrambleTracker(this.scramble);
  }

  /**
   * Feed every cube state. `move` is the quarter turn that produced it, or
   * null for a resync. Returns true if the phase changed.
   */
  onState(state: string, move: string | null, at: number): boolean {
    const before = this.phase;
    if (move) this.lastMoveAt = at;

    switch (this.phase) {
      case "needSolved":
        if (state === SOLVED) {
          this.newScramble();
          this.phase = "scrambling";
        }
        break;

      case "scrambling":
        this.tracker!.update(state, move);
        if (state === this.target) this.phase = "ready";
        break;

      case "ready":
        if (move) {
          // The first turn after the scramble is the start of the solve.
          this.startAt = at;
          this.phase = "solving";
          if (state === SOLVED) this.finishSolve(); // absurd, but possible
        } else if (state !== this.target) {
          // A resync says the cube is not where we thought.
          this.tracker!.update(state, null);
          this.phase = "scrambling";
        }
        break;

      case "solving":
        if (state === SOLVED) this.finishSolve();
        break;
    }

    return this.phase !== before;
  }

  private finishSolve() {
    // Timed from move timestamps rather than packet arrival, so Bluetooth
    // latency does not inflate the result.
    const end = Math.max(this.lastMoveAt, this.startAt);
    const seconds = Math.max(0, (end - this.startAt) / 1000);
    const { limitType, limitSeconds, resetOnFail } = this.settings;

    let accepted = true;
    if (limitType === "perSolve") accepted = seconds <= limitSeconds;
    const attempt: Attempt = { seconds, accepted, scramble: this.scramble };
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

  /** The cube state drifted; start over from a solved cube. */
  restart() {
    this.phase = "needSolved";
    this.tracker = null;
  }
}
