/**
 * Live 3D cube, drawn as flat SVG polygons with no 3D library.
 *
 * Only the stickers facing the camera are drawn. For a convex solid that is
 * exactly the visible set, so no depth sorting is needed. The cube can be
 * dragged, and — because GAN cubes report their orientation — it can also
 * follow how the cube is actually being held.
 */

import { FACELET_GEOMETRY, type Vec } from "./cube.js";

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/** Sticker half-width, as a fraction of a cubie. Leaves a visible gap. */
const STICKER = 0.43;
/** Distance from the cube centre to a face plane, in cubie units. */
const FACE = 1.5;

/* ---- small vector and quaternion helpers ---- */

const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Vec): Vec => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

const qMul = (a: Quaternion, b: Quaternion): Quaternion => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

const qConj = (q: Quaternion): Quaternion => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function qRotate(q: Quaternion, v: Vec): Vec {
  const t = cross([q.x, q.y, q.z], v).map((c) => c * 2) as unknown as Vec;
  return [
    v[0] + q.w * t[0] + cross([q.x, q.y, q.z], t)[0],
    v[1] + q.w * t[1] + cross([q.x, q.y, q.z], t)[1],
    v[2] + q.w * t[2] + cross([q.x, q.y, q.z], t)[2],
  ];
}

/**
 * The cube reports orientation with +X toward red, +Y toward blue and +Z
 * toward white, while this code uses +X right, +Y up, +Z front. These convert
 * between the two.
 */
const toCubeFrame = (v: Vec): Vec => [v[0], -v[2], v[1]];
const fromCubeFrame = (v: Vec): Vec => [v[0], v[2], -v[1]];

export const DEFAULT_VIEW = { yaw: -0.62, pitch: 0.42 };

/** Yaw then pitch, the fixed viewing angle that shows U, F and R. */
export function viewRotate(v: Vec, yaw: number, pitch: number): Vec {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const [x1, y1, z1] = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [x1, y1 * cp - z1 * sp, y1 * sp + z1 * cp];
}

/* ---- the view object ---- */

export class CubeView {
  private svg: SVGSVGElement;
  private plates: SVGPolygonElement[] = [];
  private stickers: SVGPolygonElement[] = [];
  private state = "";
  /** where the cube was when the orientation reference was taken */
  private reference: Quaternion = IDENTITY;
  private orientation: Quaternion = IDENTITY;
  private follow = true;
  private yaw = DEFAULT_VIEW.yaw;
  private pitch = DEFAULT_VIEW.pitch;
  private pending = 0;

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    const ns = "http://www.w3.org/2000/svg";
    for (let f = 0; f < 6; f++) {
      const plate = document.createElementNS(ns, "polygon");
      plate.setAttribute("class", "plate");
      svg.appendChild(plate);
      this.plates.push(plate);
    }
    for (let i = 0; i < 54; i++) {
      const p = document.createElementNS(ns, "polygon");
      svg.appendChild(p);
      this.stickers.push(p);
    }
    this.enableDrag();
  }

  setState(state: string) {
    this.state = state;
    this.schedule();
  }

  /** Feed the cube's reported orientation. */
  setOrientation(q: Quaternion) {
    this.orientation = q;
    if (this.reference === IDENTITY) this.reference = q;
    if (this.follow) this.schedule();
  }

  /** Treat the current physical orientation as "facing the camera". */
  recentre() {
    this.reference = this.orientation;
    this.yaw = DEFAULT_VIEW.yaw;
    this.pitch = DEFAULT_VIEW.pitch;
    this.schedule();
  }

  setFollow(on: boolean) {
    this.follow = on;
    if (on) this.reference = this.orientation;
    this.schedule();
  }

  get following() {
    return this.follow;
  }

  private schedule() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.draw();
    });
  }

  /** Rotation applied to every point: cube tilt first, then the viewing angle. */
  private place(v: Vec): Vec {
    let p = v;
    if (this.follow) {
      const delta = qMul(this.orientation, qConj(this.reference));
      p = fromCubeFrame(qRotate(delta, toCubeFrame(p)));
    }
    return viewRotate(p, this.yaw, this.pitch);
  }

  private draw() {
    if (!this.state) return;
    const light = norm([-0.3, 0.8, 1]);

    // One dark plate per face, so the gaps between stickers read as cube body.
    for (let f = 0; f < 6; f++) {
      const { m } = FACELET_GEOMETRY[f * 9 + 4];
      const n = this.place(m);
      if (n[2] <= 0) {
        this.plates[f].setAttribute("points", "");
        continue;
      }
      this.plates[f].setAttribute("points", this.quad(m, [0, 0, 0], 1.55));
    }

    for (let i = 0; i < 54; i++) {
      const { p, m } = FACELET_GEOMETRY[i];
      const n = this.place(m);
      const el = this.stickers[i];
      if (n[2] <= 0) {
        el.setAttribute("points", ""); // facing away, nothing to draw
        continue;
      }
      // Centre of the sticker: the cubie, pushed out to the face plane.
      const centre: Vec = [
        m[0] !== 0 ? m[0] * FACE : p[0],
        m[1] !== 0 ? m[1] * FACE : p[1],
        m[2] !== 0 ? m[2] * FACE : p[2],
      ];
      el.setAttribute("points", this.quad(m, centre, STICKER));
      el.setAttribute("class", "s " + this.state[i]);
      // Shade by how squarely the face meets the light: a cheap depth cue.
      const shade = 0.78 + 0.22 * Math.max(0, dot(norm(n), light));
      el.style.filter = `brightness(${shade.toFixed(3)})`;
    }
  }

  /** Projected corners of a square of half-width `r` on the plane of `m`. */
  private quad(m: Vec, centre: Vec, r: number): string {
    const up: Vec = Math.abs(m[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
    const u = norm(cross(up, m));
    const v = norm(cross(m, u));
    const corners: Vec[] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => [
      centre[0] + (u[0] * a + v[0] * b) * r,
      centre[1] + (u[1] * a + v[1] * b) * r,
      centre[2] + (u[2] * a + v[2] * b) * r,
    ]);
    return corners
      .map((c) => {
        const q = this.place(c);
        // Orthographic; SVG's y axis points down.
        return `${q[0].toFixed(3)},${(-q[1]).toFixed(3)}`;
      })
      .join(" ");
  }

  private enableDrag() {
    let last: { x: number; y: number } | null = null;
    this.svg.addEventListener("pointerdown", (e) => {
      last = { x: e.clientX, y: e.clientY };
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener("pointermove", (e) => {
      if (!last) return;
      this.yaw += (e.clientX - last.x) * 0.012;
      this.pitch += (e.clientY - last.y) * 0.012;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
      last = { x: e.clientX, y: e.clientY };
      this.schedule();
    });
    const release = () => (last = null);
    this.svg.addEventListener("pointerup", release);
    this.svg.addEventListener("pointercancel", release);
  }
}

export function cubeSvg(id: string): string {
  return `<svg id="${id}" class="cube3d" viewBox="-2.9 -2.9 5.8 5.8"
    role="img" aria-label="キューブの現在の状態"></svg>`;
}
