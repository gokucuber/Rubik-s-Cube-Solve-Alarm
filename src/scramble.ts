import { SOLVED, applyMove } from "./cube.js";

export interface Progress {
  /** moves of the scramble fully applied */
  done: number;
  /** halfway through move `done`, which is a double turn (one quarter applied) */
  half: boolean;
  /** the cube is somewhere on the scramble's path */
  onTrack: boolean;
  /** moves that undo the mistake, empty when on track or when unknown */
  fix: string[];
  /** off track and the way back is not known or too long to be useful */
  lost: boolean;
}

/** Longest undo sequence worth showing; past this, re-solving is quicker. */
const MAX_FIX = 6;

const FACES = "URFDLB";

/** Turn count of a token in quarter turns clockwise: R=1, R2=2, R'=3. */
const quarters = (m: string) => (m.endsWith("2") ? 2 : m.endsWith("'") ? 3 : 1);

const token = (face: string, q: number) =>
  q === 1 ? face : q === 2 ? face + "2" : face + "'";

/** Merge adjacent turns of the same face: R R -> R2, R R' -> nothing. */
export function simplify(moves: string[]): string[] {
  const out: { face: string; q: number }[] = [];
  for (const m of moves) {
    const face = m[0];
    const last = out[out.length - 1];
    if (last && last.face === face) {
      last.q = (last.q + quarters(m)) % 4;
      if (last.q === 0) out.pop();
    } else {
      out.push({ face, q: quarters(m) });
    }
  }
  return out.map((m) => token(m.face, m.q));
}

export function invert(moves: string[]): string[] {
  return moves
    .slice()
    .reverse()
    .map((m) => token(m[0], (4 - quarters(m)) % 4));
}

/**
 * Follows the cube through a scramble. The cube reports quarter turns only,
 * so a double turn in the scramble passes through a halfway state that is
 * reachable from either direction; both count as on track.
 */
export class ScrambleTracker {
  readonly moves: string[];
  private prefix = new Map<string, number>();
  private halfway = new Map<string, number>();
  /** turns made since the cube was last on the path */
  private extra: string[] = [];
  private extraKnown = true;
  progress: Progress = { done: 0, half: false, onTrack: true, fix: [], lost: false };

  constructor(scramble: string) {
    this.moves = scramble.trim().split(/\s+/);
    let s = SOLVED;
    this.prefix.set(s, 0);
    this.moves.forEach((m, i) => {
      if (!FACES.includes(m[0])) throw new Error("bad scramble move: " + m);
      if (quarters(m) === 2) {
        this.halfway.set(applyMove(s, m[0]), i);
        this.halfway.set(applyMove(s, m[0] + "'"), i);
      }
      s = applyMove(s, m);
      this.prefix.set(s, i + 1);
    });
  }

  /**
   * Feed every new cube state. `move` is the quarter turn that produced it,
   * or null when the state came from a resync and the path there is unknown.
   */
  update(state: string, move: string | null): Progress {
    const k = this.prefix.get(state);
    const h = this.halfway.get(state);
    if (k !== undefined || h !== undefined) {
      this.extra = [];
      this.extraKnown = true;
      this.progress = {
        done: k ?? h!,
        half: k === undefined,
        onTrack: true,
        fix: [],
        lost: false,
      };
      return this.progress;
    }

    if (move === null) this.extraKnown = false;
    else this.extra = simplify([...this.extra, move]);

    const fix = this.extraKnown ? invert(this.extra) : [];
    const lost = !this.extraKnown || fix.length === 0 || fix.length > MAX_FIX;
    this.progress = {
      done: this.progress.done,
      half: this.progress.half,
      onTrack: false,
      fix: lost ? [] : fix,
      lost,
    };
    return this.progress;
  }
}
