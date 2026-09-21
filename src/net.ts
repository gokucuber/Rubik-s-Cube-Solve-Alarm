/**
 * Unfolded cube ("net") drawn from a facelet string, repainted in place on
 * every turn. Layout is the standard cross:
 *
 *        U
 *     L  F  R  B
 *        D
 */

// Position of each face's top-left sticker in the 12x9 sticker grid, URFDLB.
const ORIGIN: [number, number][] = [
  [3, 0], // U
  [6, 3], // R
  [3, 3], // F
  [3, 6], // D
  [0, 3], // L
  [9, 3], // B
];

export function netSvg(id: string): string {
  const cells: string[] = [];
  for (let i = 0; i < 54; i++) {
    const [ox, oy] = ORIGIN[Math.floor(i / 9)];
    const x = ox + (i % 9) % 3;
    const y = oy + Math.floor((i % 9) / 3);
    cells.push(
      `<rect data-i="${i}" x="${x + 0.06}" y="${y + 0.06}" width="0.88" height="0.88" rx="0.14"/>`
    );
  }
  return `<svg id="${id}" class="net" viewBox="0 0 12 9" role="img" aria-label="キューブの現在の状態">${cells.join("")}</svg>`;
}

/** Colour each sticker by the face letter at its index. */
export function paintNet(svg: Element, state: string) {
  const rects = svg.querySelectorAll("rect");
  for (let i = 0; i < 54 && i < rects.length; i++) {
    rects[i].setAttribute("class", "s " + state[i]);
  }
}
