import "./style.css";
import { SOLVED } from "./cube.js";
import { Challenge } from "./challenge.js";
import { bluetoothAvailable, connectCube, type CubeHandle } from "./conn.js";
import {
  acquireWakeLock,
  blip,
  keepWakeLockAlive,
  releaseWakeLock,
  startAlarm,
  stopAlarm,
  unlockAudio,
} from "./alarm.js";
import {
  DEFAULTS,
  loadSettings,
  loadSound,
  saveSettings,
  saveSound,
  type LimitType,
  type Settings,
} from "./store.js";

const app = document.getElementById("app") as HTMLElement;

type Screen = "setup" | "armed" | "ringing" | "cleared";

let settings: Settings = loadSettings();
let sound: Blob | undefined;
let cube: CubeHandle | null = null;
let connecting = false;
let connectError = "";
let battery: number | null = null;
let facelets = SOLVED;
let screen: Screen = "setup";
let challenge: Challenge | null = null;
let alarmAt = 0;
let ticker = 0;
let frame = 0;

/* ------------------------------------------------------------------ */
/* cube connection                                                     */
/* ------------------------------------------------------------------ */

async function connect() {
  if (connecting || cube) return;
  connecting = true;
  connectError = "";
  render();
  try {
    cube = await connectCube(
      {
        onFacelets: (f) => {
          facelets = f;
          if (challenge && challenge.onFacelets(f)) onPhaseChange();
        },
        onMove: (_move, at) => {
          if (challenge && challenge.onMove(at)) onPhaseChange();
        },
        onBattery: (level) => {
          battery = level;
          render();
        },
        onDisconnect: () => {
          cube = null;
          render();
        },
      },
      settings.cubeMac,
      askForMac
    );
    if (cube.mac && cube.mac !== settings.cubeMac) {
      settings = { ...settings, cubeMac: cube.mac };
      saveSettings(settings);
    }
  } catch (err) {
    connectError =
      err instanceof Error && err.name === "NotFoundError"
        ? "キューブが選ばれませんでした。白い面を3秒以内に3回同じ向きに回して起こしてから、もう一度試してください。"
        : "接続できませんでした。CubeStationなど他のアプリがキューブを掴んでいないか確認してください。";
  } finally {
    connecting = false;
    render();
  }
}

async function askForMac(deviceName: string): Promise<string | null> {
  const entered = window.prompt(
    `${deviceName} のMACアドレスを入力してください（AB:12:34:5D:34:12 形式）。\n` +
      `nRF Connect か chrome://bluetooth-internals/#devices で調べられます。`,
    settings.cubeMac ?? ""
  );
  if (!entered) return null;
  const mac = entered.trim().toUpperCase().replace(/-/g, ":");
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
    window.alert("MACアドレスの形式が違います。");
    return null;
  }
  settings = { ...settings, cubeMac: mac };
  saveSettings(settings);
  return mac;
}

/* ------------------------------------------------------------------ */
/* alarm lifecycle                                                     */
/* ------------------------------------------------------------------ */

function nextAlarmTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const when = new Date();
  when.setHours(h, m, 0, 0);
  if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);
  return when.getTime();
}

async function arm() {
  await unlockAudio(sound);
  await acquireWakeLock();
  alarmAt = nextAlarmTime(settings.alarmTime);
  screen = "armed";
  ticker = window.setInterval(() => {
    if (screen === "armed" && Date.now() >= alarmAt) fire();
    else if (screen === "armed") render();
  }, 500);
  render();
}

function disarm() {
  window.clearInterval(ticker);
  ticker = 0;
  stopAlarm();
  void releaseWakeLock();
  challenge = null;
  screen = "setup";
  render();
}

function fire() {
  window.clearInterval(ticker);
  ticker = 0;
  challenge = new Challenge(settings);
  if (cube) challenge.onFacelets(facelets);
  screen = "ringing";
  void startAlarm(settings.rampSeconds);
  render();
  loopTimer();
}

function onPhaseChange() {
  if (!challenge) return;
  if (challenge.phase === "cleared") {
    stopAlarm();
    void releaseWakeLock();
    screen = "cleared";
  } else if (challenge.lastResult) {
    blip(challenge.lastResult.accepted);
    challenge.lastResult = null;
  }
  render();
}

/** Repaints the running timer without re-rendering the whole screen. */
function loopTimer() {
  cancelAnimationFrame(frame);
  const step = () => {
    if (screen !== "ringing") return;
    const node = document.getElementById("timer");
    if (node && challenge?.phase === "solving") {
      node.textContent = challenge.elapsed.toFixed(2);
      node.classList.toggle(
        "over",
        settings.limitType === "perSolve" &&
          challenge.elapsed > settings.limitSeconds
      );
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

keepWakeLockAlive(() => screen === "armed" || screen === "ringing");

window.addEventListener("beforeunload", (e) => {
  if (screen === "armed" || screen === "ringing") {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function cubeStatusHtml(): string {
  if (!cube)
    return `<div class="status"><i class="dot lost"></i>キューブ未接続</div>`;
  const pct = battery === null ? "" : ` · バッテリー ${battery}%`;
  const low = battery !== null && battery < 30;
  return `<div class="status"><i class="dot live"></i>${esc(cube.name)}${pct}</div>${
    low ? `<p class="note warn">バッテリーが少なめです。朝に切れると解除できません。充電してください。</p>` : ""
  }`;
}

function scrambleHtml(scramble: string): string {
  return `<div class="scramble">${scramble
    .split(" ")
    .map((m) => `<div class="move ${m[0]}">${esc(m)}</div>`)
    .join("")}</div>`;
}

function setupScreen(): string {
  const s = settings;
  const limitLabel =
    s.limitType === "perSolve"
      ? "1回あたりの制限（秒）"
      : s.limitType === "total"
      ? "合計の制限（秒）"
      : "";
  return `
    <h1>Cube Alarm</h1>
    <p class="lede">キューブを指定の回数そろえるまで鳴り続けます。</p>

    <div class="panel">
      <div class="field">
        <span>起こす時刻</span>
        <input type="time" id="time" value="${s.alarmTime}" />
      </div>
    </div>

    <div class="panel">
      <div class="field">
        <span>止めるための条件</span>
        <select id="limitType">
          <option value="none"${s.limitType === "none" ? " selected" : ""}>回数だけ</option>
          <option value="perSolve"${s.limitType === "perSolve" ? " selected" : ""}>1回ごとにタイム制限</option>
          <option value="total"${s.limitType === "total" ? " selected" : ""}>合計タイム制限</option>
        </select>
      </div>
      <div class="row">
        <label class="field">
          <span>そろえる回数</span>
          <input type="number" id="solves" min="1" max="20" value="${s.solves}" />
        </label>
        ${
          s.limitType === "none"
            ? ""
            : `<label class="field"><span>${limitLabel}</span>
               <input type="number" id="limitSeconds" min="3" max="600" value="${s.limitSeconds}" /></label>`
        }
      </div>
      ${
        s.limitType === "perSolve"
          ? `<label class="check"><input type="checkbox" id="resetOnFail"${
              s.resetOnFail ? " checked" : ""
            } />制限を超えたら最初からやり直し</label>`
          : ""
      }
      <p class="note">いまの条件: ${esc(new Challenge(s).goal)}</p>
    </div>

    <div class="panel">
      <div class="row">
        <label class="field">
          <span>スクランブル手数</span>
          <input type="number" id="scrambleLength" min="15" max="30" value="${s.scrambleLength}" />
        </label>
        <label class="field">
          <span>最大音量まで（秒）</span>
          <input type="number" id="rampSeconds" min="0" max="120" value="${s.rampSeconds}" />
        </label>
      </div>
      <div class="field">
        <span>アラーム音${s.soundName ? `： ${esc(s.soundName)}` : "（未選択なら電子音）"}</span>
        <input type="file" id="sound" accept="audio/*" />
      </div>
    </div>

    <div class="panel">
      ${cubeStatusHtml()}
      ${connectError ? `<p class="note warn">${esc(connectError)}</p>` : ""}
      ${
        cube
          ? `<p class="note">${
              facelets === SOLVED
                ? "キューブはそろっています。このまま接続を保って枕元へ。"
                : "キューブがそろっていません。寝る前にそろえておくと朝がスムーズです。"
            }</p>`
          : `<button id="connect"${connecting ? " disabled" : ""}>${
              connecting ? "接続中…" : "キューブを接続して確認"
            }</button>
             <p class="note">寝る前に繋いでおくと、バッテリー残量を確認でき、朝は接続手順を飛ばせます。</p>`
      }
    </div>

    <div class="grow"></div>
    <button class="primary" id="arm">アラームをセット</button>
    <p class="note">セット後はこの画面を開いたまま、充電しながら枕元に置いてください。画面は自動で点いたままになります。</p>
  `;
}

function armedScreen(): string {
  const now = new Date();
  const diff = Math.max(0, alarmAt - Date.now());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `
    ${cubeStatusHtml()}
    <div class="armed-main">
      <div class="clock">${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}</div>
      <div class="until">${settings.alarmTime} に起動 · あと ${h}時間${m}分</div>
      <div class="until">${esc(new Challenge(settings).goal)} そろえるまで止まりません</div>
    </div>
    <div class="grow"></div>
    <button class="quiet" id="disarm">アラームを解除する</button>
  `;
}

function ringingScreen(): string {
  const c = challenge!;
  const pips = Array.from(
    { length: c.required },
    (_, i) => `<i class="pip${i < c.accepted ? " done" : ""}"></i>`
  ).join("");
  const history = c.attempts
    .map(
      (a) =>
        `<span class="${a.accepted ? "" : "miss"}">${a.seconds.toFixed(2)}</span>`
    )
    .join("");

  let body: string;

  if (!cube) {
    body = `
      <p class="big-instruction">キューブを接続</p>
      <p class="lede" style="text-align:center;margin-inline:auto">
        白い面を3秒以内に3回まわして起こしてから、下のボタンを押してください。
      </p>
      ${connectError ? `<p class="note warn">${esc(connectError)}</p>` : ""}
      <div class="grow"></div>
      <button class="primary" id="connect"${connecting ? " disabled" : ""}>${
      connecting ? "接続中…" : "接続する"
    }</button>`;
  } else if (c.phase === "needSolved") {
    body = `
      <p class="big-instruction">まずキューブをそろえて</p>
      <p class="lede" style="text-align:center;margin-inline:auto">
        そろった状態から始めます。この1回は回数に入りません。
      </p>
      <div class="grow"></div>
      <button id="reset">そろっているのに進まないときはここを押す</button>`;
  } else if (c.phase === "scrambling") {
    body = `
      <p class="big-instruction">この通りにスクランブル</p>
      ${scrambleHtml(c.scramble)}
      <p class="note" style="text-align:center">白を上・緑を手前に持って · 残り ${c.remaining} 面</p>
      <div class="grow"></div>`;
  } else if (c.phase === "ready") {
    body = `
      <p class="big-instruction">回し始めたらスタート</p>
      <div class="timer" id="timer">0.00</div>
      <div class="grow"></div>`;
  } else {
    body = `
      <div class="timer" id="timer">${c.elapsed.toFixed(2)}</div>
      <p class="note" style="text-align:center">${esc(
        settings.limitType === "perSolve" ? `${settings.limitSeconds}秒以内` : "そろえろ"
      )}</p>
      <div class="grow"></div>`;
  }

  return `
    ${cubeStatusHtml()}
    <div class="status">${esc(new Challenge(settings).goal)} · ${c.accepted}/${c.required} 達成</div>
    <div class="progress">${pips}</div>
    ${history ? `<div class="history">${history}</div>` : ""}
    ${body}
    <button class="quiet" id="escape">緊急停止（10秒長押し）</button>
  `;
}

function clearedScreen(): string {
  const c = challenge!;
  const times = c.attempts.filter((a) => a.accepted).map((a) => a.seconds);
  const best = Math.min(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return `
    <div class="grow"></div>
    <p class="big-instruction">おはよう</p>
    <div class="history">${times.map((t) => t.toFixed(2)).join(" · ")}</div>
    <p class="note" style="text-align:center">ベスト ${best.toFixed(2)} · 平均 ${avg.toFixed(2)}</p>
    <div class="grow"></div>
    <button class="primary" id="again">設定にもどる</button>
  `;
}

function render() {
  document.body.classList.toggle("ringing", screen === "ringing");
  if (screen === "setup") app.innerHTML = setupScreen();
  else if (screen === "armed") app.innerHTML = armedScreen();
  else if (screen === "ringing") app.innerHTML = ringingScreen();
  else app.innerHTML = clearedScreen();
  wire();
  if (screen === "ringing") loopTimer();
}

/* ------------------------------------------------------------------ */
/* event wiring                                                        */
/* ------------------------------------------------------------------ */

function update(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  saveSettings(settings);
  render();
}

function on<T extends HTMLElement>(id: string, event: string, fn: (el: T) => void) {
  const node = document.getElementById(id) as T | null;
  if (node) node.addEventListener(event, () => fn(node));
}

function wire() {
  on<HTMLInputElement>("time", "change", (el) => update({ alarmTime: el.value }));
  on<HTMLSelectElement>("limitType", "change", (el) =>
    update({ limitType: el.value as LimitType })
  );
  on<HTMLInputElement>("solves", "change", (el) =>
    update({ solves: clamp(el.value, 1, 20, DEFAULTS.solves) })
  );
  on<HTMLInputElement>("limitSeconds", "change", (el) =>
    update({ limitSeconds: clamp(el.value, 3, 600, DEFAULTS.limitSeconds) })
  );
  on<HTMLInputElement>("resetOnFail", "change", (el) =>
    update({ resetOnFail: el.checked })
  );
  on<HTMLInputElement>("scrambleLength", "change", (el) =>
    update({ scrambleLength: clamp(el.value, 15, 30, DEFAULTS.scrambleLength) })
  );
  on<HTMLInputElement>("rampSeconds", "change", (el) =>
    update({ rampSeconds: clamp(el.value, 0, 120, DEFAULTS.rampSeconds) })
  );

  on<HTMLInputElement>("sound", "change", async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    sound = file;
    await saveSound(file);
    update({ soundName: file.name });
  });

  on("connect", "click", () => void connect());
  on("arm", "click", () => void arm());
  on("disarm", "click", disarm);
  on("again", "click", () => {
    challenge = null;
    screen = "setup";
    render();
  });
  on("reset", "click", () => {
    if (
      window.confirm(
        "キューブが物理的にそろっている状態でだけ押してください。いまの状態を「そろった」として記録し直します。"
      )
    ) {
      void cube?.reset();
      challenge?.restart();
      render();
    }
  });

  wireEscapeHatch();
}

function clamp(value: string, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Deliberately tedious way out, for the morning the cube battery dies.
 * Ten seconds of holding is long enough that it is never the easy option.
 */
function wireEscapeHatch() {
  const btn = document.getElementById("escape") as HTMLButtonElement | null;
  if (!btn) return;
  let held = 0;
  let timer = 0;
  const label = btn.textContent!;

  const begin = () => {
    held = Date.now();
    timer = window.setInterval(() => {
      const left = 10 - Math.floor((Date.now() - held) / 1000);
      if (left <= 0) {
        end();
        disarm();
      } else {
        btn.textContent = `あと ${left} 秒…`;
      }
    }, 100);
  };
  const end = () => {
    window.clearInterval(timer);
    btn.textContent = label;
  };

  btn.addEventListener("pointerdown", begin);
  btn.addEventListener("pointerup", end);
  btn.addEventListener("pointerleave", end);
  btn.addEventListener("pointercancel", end);
}

/* ------------------------------------------------------------------ */

async function boot() {
  sound = await loadSound();
  if (!bluetoothAvailable()) {
    app.innerHTML = `
      <h1>Cube Alarm</h1>
      <p class="lede">このブラウザはWeb Bluetoothに対応していません。
      Android の Chrome、または PC の Chrome で開いてください。</p>`;
    return;
  }
  render();
}

void boot();
