/**
 * 3x3 cube state as a 54-character Kociemba facelet string (URFDLB order).
 *
 * Move permutations are derived from 3D geometry rather than hand-written
 * tables, so they cannot be subtly wrong: each facelet is described by the
 * coordinate of its cubie and the direction its sticker points, and a face
 * turn is a real 90-degree rotation of both vectors.
 */

export const SOLVED =
  "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

type Vec = readonly [number, number, number];

/** Face order is URFDLB. For each: outward normal, and the 3D directions of
 *  "one column to the right" and "one row down" in Kociemba reading order. */
const FACES: { name: string; n: Vec; col: Vec; row: Vec }[] = [
  { name: "U", n: [0, 1, 0], col: [1, 0, 0], row: [0, 0, 1] },
  { name: "R", n: [1, 0, 0], col: [0, 0, -1], row: [0, -1, 0] },
  { name: "F", n: [0, 0, 1], col: [1, 0, 0], row: [0, -1, 0] },
  { name: "D", n: [0, -1, 0], col: [1, 0, 0], row: [0, 0, -1] },
  { name: "L", n: [-1, 0, 0], col: [0, 0, 1], row: [0, -1, 0] },
  { name: "B", n: [0, 0, -1], col: [-1, 0, 0], row: [0, -1, 0] },
];

const add = (a: Vec, b: Vec, k: number): Vec => [
  a[0] + b[0] * k,
  a[1] + b[1] * k,
  a[2] + b[2] * k,
];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const key = (p: Vec, m: Vec) => p.join(",") + "|" + m.join(",");

/** Rotate v by -90 degrees about unit axis n (clockwise seen from outside). */
const rot = (v: Vec, n: Vec): Vec => {
  const c = cross(n, v);
  const d = dot(n, v);
  return [-c[0] + n[0] * d, -c[1] + n[1] * d, -c[2] + n[2] * d];
};

/** facelet index -> { cubie position, sticker normal } */
const GEOMETRY: { p: Vec; m: Vec }[] = [];
/** "pos|normal" -> facelet index */
const INDEX = new Map<string, number>();

for (const f of FACES) {
  // top-left corner of this face in 3D: centre + normal, minus one step of
  // each of the row and column directions.
  const origin = add(add(f.n, f.col, -1), f.row, -1);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const p = add(add(origin, f.row, r), f.col, c);
      GEOMETRY.push({ p, m: f.n });
      INDEX.set(key(p, f.n), GEOMETRY.length - 1);
    }
  }
}

/** For each of the 6 faces, a permutation array: dest[i] = source index. */
const PERM: number[][] = FACES.map((f) => {
  const perm = new Array<number>(54);
  for (let i = 0; i < 54; i++) perm[i] = i;
  for (let i = 0; i < 54; i++) {
    const { p, m } = GEOMETRY[i];
    if (dot(p, f.n) !== 1) continue; // sticker not on the turning layer
    const dest = INDEX.get(key(rot(p, f.n), rot(m, f.n)));
    if (dest === undefined) throw new Error("bad geometry for " + f.name);
    perm[dest] = i;
  }
  return perm;
});

const FACE_LETTERS = FACES.map((f) => f.name);

/** Apply a single move token ("R", "U'", "F2", ...) to a facelet string. */
export function applyMove(state: string, token: string): string {
  const face = FACE_LETTERS.indexOf(token[0]);
  if (face < 0) throw new Error("unknown move: " + token);
  const turns = token.endsWith("2") ? 2 : token.endsWith("'") ? 3 : 1;
  const perm = PERM[face];
  let s = state;
  for (let t = 0; t < turns; t++) {
    const next = new Array<string>(54);
    for (let i = 0; i < 54; i++) next[i] = s[perm[i]];
    s = next.join("");
  }
  return s;
}

/** Apply a whole sequence, e.g. "R U R' U'". */
export function applyMoves(state: string, sequence: string): string {
  return sequence
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reduce(applyMove, state);
}

export const isSolved = (state: string) => state === SOLVED;

/** The facelet state you reach by applying `scramble` to a solved cube. */
export const scrambledState = (scramble: string) =>
  applyMoves(SOLVED, scramble);

/** How many facelets differ — used to show "almost there" feedback. */
export function differences(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < 54; i++) if (a[i] !== b[i]) n++;
  return n;
}

const AXIS = [0, 1, 2, 0, 1, 2]; // U/D share an axis, R/L, F/B
const SUFFIX = ["", "'", "2"];

/**
 * Random-move scramble with the usual redundancy filters: never the same face
 * twice in a row, and never a third move on an axis that is already covered.
 * Not WCA random-state, but indistinguishable in practice for this purpose.
 */
export function randomScramble(length = 22): string {
  const moves: string[] = [];
  let lastFace = -1;
  let prevFace = -1;
  while (moves.length < length) {
    const face = Math.floor(Math.random() * 6);
    if (face === lastFace) continue;
    if (
      prevFace >= 0 &&
      AXIS[face] === AXIS[lastFace] &&
      AXIS[face] === AXIS[prevFace]
    )
      continue;
    moves.push(
      FACE_LETTERS[face] + SUFFIX[Math.floor(Math.random() * 3)]
    );
    prevFace = lastFace;
    lastFace = face;
  }
  return moves.join(" ");
}
