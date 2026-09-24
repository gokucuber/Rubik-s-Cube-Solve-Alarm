import { FACELET_GEOMETRY } from "./cube.js";
import { DEFAULT_VIEW, qRotate, viewRotate } from "./cube3d.js";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const round = (v: readonly number[]) => v.map((n) => Math.round(n * 1000) / 1000);

// --- quaternion rotation ----------------------------------------------
const h = Math.SQRT1_2;
check("90 deg about Z takes +X to +Y", round(qRotate({ x: 0, y: 0, z: h, w: h }, [1, 0, 0])), [0, 1, 0]);
check("90 deg about X takes +Y to +Z", round(qRotate({ x: h, y: 0, z: 0, w: h }, [0, 1, 0])), [0, 0, 1]);
check("identity leaves a vector alone", round(qRotate({ x: 0, y: 0, z: 0, w: 1 }, [0.3, -0.4, 0.5])), [0.3, -0.4, 0.5]);

// --- the default camera shows exactly U, F and R -----------------------
const facing = (v: readonly [number, number, number]) =>
  viewRotate(v, DEFAULT_VIEW.yaw, DEFAULT_VIEW.pitch)[2] > 0;

check("U faces the camera", facing([0, 1, 0]), true);
check("F faces the camera", facing([0, 0, 1]), true);
check("R faces the camera", facing([1, 0, 0]), true);
check("D is hidden", facing([0, -1, 0]), false);
check("B is hidden", facing([0, 0, -1]), false);
check("L is hidden", facing([-1, 0, 0]), false);

const visible = FACELET_GEOMETRY.filter((g) => facing(g.m)).length;
check("exactly half the stickers are drawn", visible, 27);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
