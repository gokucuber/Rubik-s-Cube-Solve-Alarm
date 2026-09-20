import { SOLVED, applyMoves, randomScramble, scrambledState, isSolved } from "./cube.js";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      expected ${expected}\n      actual   ${actual}`);
}

// Ground truth published in the gan-web-bluetooth documentation for "F R".
check(
  'facelets after "F R" match GAN reference',
  applyMoves(SOLVED, "F R"),
  "UUFUUFLLFUUURRRRRRFFRFFDFFDRRBDDBDDBLLDLLDLLDLBBUBBUBB"
);

for (const f of ["U", "R", "F", "D", "L", "B"]) {
  check(`${f} x4 is identity`, applyMoves(SOLVED, `${f} ${f} ${f} ${f}`), SOLVED);
  check(`${f} then ${f}' is identity`, applyMoves(SOLVED, `${f} ${f}'`), SOLVED);
  check(`${f}2 twice is identity`, applyMoves(SOLVED, `${f}2 ${f}2`), SOLVED);
}

// Sexy move has order 6; this fails loudly if any face is wired to the wrong neighbours.
check(
  "(R U R' U') x6 is identity",
  applyMoves(SOLVED, "R U R' U' ".repeat(6)),
  SOLVED
);
check(
  "(R U R' U') x3 is not identity",
  applyMoves(SOLVED, "R U R' U' ".repeat(3)) !== SOLVED,
  true
);
// Sune has order 6, T-perm is its own inverse.
check("Sune x6 is identity", applyMoves(SOLVED, "R U R' U R U2 R' ".repeat(6)), SOLVED);
check(
  "T-perm twice is identity",
  applyMoves(SOLVED, "R U R' U' R' F R2 U' R' U' R U R' F' ".repeat(2)),
  SOLVED
);

// Scrambles must actually scramble, and stay reversible.
let allScrambled = true;
let allReversible = true;
for (let i = 0; i < 500; i++) {
  const s = randomScramble();
  const st = scrambledState(s);
  if (isSolved(st)) allScrambled = false;
  const inverse = s
    .split(" ")
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m[0] : m + "'"))
    .join(" ");
  if (applyMoves(st, inverse) !== SOLVED) allReversible = false;
}
check("500 random scrambles all leave the cube unsolved", allScrambled, true);
check("500 random scrambles all invert back to solved", allReversible, true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
