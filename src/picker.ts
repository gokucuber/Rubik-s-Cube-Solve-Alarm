/**
 * Scroll-wheel time picker built on CSS scroll snapping: each column is an
 * ordinary vertically scrolling list, and whichever row sits in the centre
 * band is the selected value.
 */

const ROW = 52; // px; must match .wheel .opt height in style.css
const VISIBLE = 5; // rows shown, odd so there is a centre row

const pad = (n: number) => String(n).padStart(2, "0");

function column(id: string, count: number, label: string): string {
  const opts = Array.from(
    { length: count },
    (_, i) => `<div class="opt" data-v="${i}">${pad(i)}</div>`
  ).join("");
  const spacer = `<div class="spacer" style="height:${ROW * ((VISIBLE - 1) / 2)}px"></div>`;
  return `<div class="wheel" id="${id}" role="listbox" aria-label="${label}" tabindex="0"
    style="height:${ROW * VISIBLE}px">${spacer}${opts}${spacer}</div>`;
}

export function timePickerHtml(): string {
  return `<div class="picker">
    <div class="band" style="height:${ROW}px"></div>
    ${column("wheel-h", 24, "時")}
    <div class="colon">:</div>
    ${column("wheel-m", 60, "分")}
  </div>`;
}

/**
 * Scroll both wheels to `hhmm`, and report a new value whenever the user
 * lets a wheel come to rest on a different row.
 */
export function wireTimePicker(hhmm: string, onChange: (hhmm: string) => void) {
  const h = document.getElementById("wheel-h");
  const m = document.getElementById("wheel-m");
  if (!h || !m) return;

  const [hh, mm] = hhmm.split(":").map(Number);
  const value = { h: hh, m: mm };

  const setup = (wheel: HTMLElement, key: "h" | "m", max: number) => {
    wheel.scrollTop = value[key] * ROW;
    highlight(wheel);

    let settle = 0;
    let frame = 0;
    const commit = () => {
      const v = Math.min(max - 1, Math.max(0, Math.round(wheel.scrollTop / ROW)));
      if (v !== value[key]) {
        value[key] = v;
        onChange(`${pad(value.h)}:${pad(value.m)}`);
      }
    };
    wheel.addEventListener(
      "scroll",
      () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => highlight(wheel));
        // Fallback for browsers without scrollend.
        clearTimeout(settle);
        settle = window.setTimeout(commit, 140);
      },
      { passive: true }
    );
    wheel.addEventListener("scrollend", commit);

    // Tapping a row scrolls it into the centre.
    wheel.addEventListener("click", (e) => {
      const opt = (e.target as HTMLElement).closest(".opt") as HTMLElement | null;
      if (opt) wheel.scrollTo({ top: Number(opt.dataset.v) * ROW, behavior: "smooth" });
    });

    // Keyboard support for desktop testing.
    wheel.addEventListener("keydown", (e) => {
      const delta = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (!delta) return;
      e.preventDefault();
      wheel.scrollBy({ top: delta * ROW, behavior: "smooth" });
    });
  };

  setup(h, "h", 24);
  setup(m, "m", 60);
}

function highlight(wheel: HTMLElement) {
  const centre = Math.round(wheel.scrollTop / ROW);
  wheel.querySelectorAll<HTMLElement>(".opt").forEach((o, i) => {
    o.classList.toggle("on", i === centre);
  });
}
