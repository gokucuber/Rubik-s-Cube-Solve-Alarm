import "./style.css";
import { SOLVED } from "./cube.js";
import { Challenge } from "./challenge.js";
import { bluetoothAvailable, connectCube, type CubeHandle } from "./conn.js";
import { netSvg, paintNet } from "./net.js";
import { timePickerHtml, wireTimePicker } from "./picker.js";
import {
  acquireWakeLock,
  blip,
  keepWakeLockAlive,
  previewAlarm,
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
let cubeState = SOLVED;
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
        onState: (state, move, at) => {
          cubeState = state;
          if (challenge && challenge.onState(state, move, at)) onPhaseChange();
          else refreshLive();
        },
        onBattery: (level) => {
          battery = level;
          refreshStatus();
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

function describeAlarm(hhmm: string): string {
  const at = nextAlarmTime(hhmm);
  const diff = at - Date.now();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const day = new Date(at).getDate() === new Date().getDate() ? "今日" : "明日";
  return `${day} ${hhmm} に鳴ります · あと ${h}時間${m}分`;
}

async function arm() {
  await unlockAudio(sound);
  await acquireWakeLock();
  alarmAt = nextAlarmTime(settings.alarmTime);
  screen = "armed";
  ticker = window.setInterval(() => {
    if (screen === "armed" && Date.now() >= alarmAt) fire();
    else if (screen === "armed") render();
  }, 1000);
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
  if (cube) challenge.onState(cubeState, null, performance.now());
  screen = "ringing";
  void startAlarm(settings.rampSeconds);
  render();
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

/** Repaints the running timer without touching the rest of the screen. */
function loopTimer() {
  cancelAnimationFrame(frame);
  const step = () => {
    if (screen !== "ringing") return;
    const node = document.getElementById("timer");
    if (node && challenge?.phase === "solving") {
      node.textContent = challenge.elapsed.toFixed(2);
      node.classList.toggle(
        "over",
        settings.limitType === "perSolve" && challenge.elapsed > settings.limitSeconds
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

const moveCells = (moves: string[], cls = "") =>
  moves.map((m, i) => `<div class="move ${m[0]} ${cls}" data-i="${i}">${esc(m)}</div>`).join("");

function statusHtml(): string {
  if (!cube) return `<div class="status" id="status"><i class="dot lost"></i>キューブ未接続</div>`;
  const pct = battery === null ? "" : ` · バッテリー ${battery}%`;
  const low = battery !== null && battery < 30;
  return `<div class="status" id="status"><i class="dot live"></i>${esc(cube.name)}${pct}${
    low ? `<span class="warn">　充電してください</span>` : ""
  }</div>`;
}

function setupScreen(): string {
  const s = settings;
  const limitLabel =
    s.limitType === "perSolve" ? "1回あたりの制限（秒）" : s.limitType === "total" ? "合計の制限（秒）" : "";
  return `
    <h1>Cube Alarm</h1>

    <div class="panel">
      ${timePickerHtml()}
      <p class="note center" id="alarm-desc">${describeAlarm(s.alarmTime)}</p>
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
      <button id="preview">音を試聴する（4秒）</button>
    </div>

    <div class="panel">
      ${statusHtml()}
      ${connectError ? `<p class="note warn">${esc(connectError)}</p>` : ""}
      ${
        cube
          ? `${netSvg("net")}
             <p class="note center" id="setup-cube-note"></p>
             <button id="disconnect">切断する</button>
             <p class="note">繋いだまま寝てもいいですが、キューブのバッテリーを一晩使います。朝に繋ぎ直せるので、残量が心細ければ切ってください。</p>`
          : `<button id="connect"${connecting ? " disabled" : ""}>${
              connecting ? "接続中…" : "キューブを接続して確認"
            }</button>
             <p class="note">バッテリー残量の確認用です。繋ぎっぱなしにする必要はありません。</p>`
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
    ${statusHtml()}
    <div class="armed-main">
      <div class="clock">${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}</div>
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
    .map((a) => `<span class="${a.accepted ? "" : "miss"}">${a.seconds.toFixed(2)}</span>`)
    .join("");

  let body: string;

  if (!cube) {
    body = `
      <p class="big-instruction">キューブを接続</p>
      <p class="lede center">白い面を3秒以内に3回まわして起こしてから、下のボタンを押してください。</p>
      ${connectError ? `<p class="note warn">${esc(connectError)}</p>` : ""}
      <div class="grow"></div>
      <button class="primary" id="connect"${connecting ? " disabled" : ""}>${connecting ? "接続中…" : "接続する"}</button>`;
  } else if (c.phase === "needSolved") {
    body = `
      <p class="big-instruction">まずキューブをそろえて</p>
      <p class="lede center">そろった状態から始めます。この1回は回数に入りません。</p>
      ${netSvg("net")}
      <p class="note center">画面の図が手元のキューブと違うときは、キューブの記録がずれています。手元をそろえてから下のボタンを押してください。</p>
      <div class="grow"></div>
      <button id="reset">手元はそろっているのに進まない</button>`;
  } else if (c.phase === "scrambling") {
    body = `
      <p class="big-instruction">この通りにスクランブル</p>
      <div class="scramble" id="scramble">${moveCells(c.tracker!.moves)}</div>
      <div id="fix" class="fix" aria-live="assertive"></div>
      <p class="note center" id="scr-progress"></p>
      ${netSvg("net")}
      <div class="grow"></div>`;
  } else if (c.phase === "ready") {
    body = `
      <p class="big-instruction">回し始めたらスタート</p>
      <div class="timer" id="timer">0.00</div>
      ${netSvg("net")}
      <div class="grow"></div>`;
  } else {
    body = `
      <div class="timer" id="timer">${c.elapsed.toFixed(2)}</div>
      <p class="note center">${esc(settings.limitType === "perSolve" ? `${settings.limitSeconds}秒以内` : "そろえろ")}</p>
      ${netSvg("net")}
      <div class="grow"></div>`;
  }

  return `
    ${statusHtml()}
    <div class="status">${esc(c.goal)} · ${c.accepted}/${c.required} 達成</div>
    <div class="progress">${pips}</div>
    ${history ? `<div class="history">${history}</div>` : ""}
    ${body}
    <button class="quiet" id="escape">緊急停止（10秒長押し）</button>
  `;
}

function clearedScreen(): string {
  const times = challenge!.attempts.filter((a) => a.accepted).map((a) => a.seconds);
  const best = Math.min(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return `
    <div class="grow"></div>
    <p class="big-instruction">おはよう</p>
    <div class="history">${times.map((t) => t.toFixed(2)).join(" · ")}</div>
    <p class="note center">ベスト ${best.toFixed(2)} · 平均 ${avg.toFixed(2)}</p>
    <div class="grow"></div>
    <button class="primary" id="again">設定にもどる</button>
  `;
}

/** Rebuilds the whole screen. Only on screen or phase changes. */
function render() {
  document.body.classList.toggle("ringing", screen === "ringing");
  if (screen === "setup") app.innerHTML = setupScreen();
  else if (screen === "armed") app.innerHTML = armedScreen();
  else if (screen === "ringing") app.innerHTML = ringingScreen();
  else app.innerHTML = clearedScreen();
  wire();
  refreshLive();
  if (screen === "ringing") loopTimer();
}

function refreshStatus() {
  const node = document.getElementById("status");
  if (node) node.outerHTML = statusHtml();
}

/**
 * Updates everything that follows the cube turn by turn, in place, so that
 * the screen keeps up with fast turning without being rebuilt.
 */
function refreshLive() {
  const net = document.getElementById("net");
  if (net) paintNet(net, cubeState);

  const note = document.getElementById("setup-cube-note");
  if (note) {
    note.textContent =
      cubeState === SOLVED
        ? "そろっています。手元と同じ図になっていれば準備OKです。"
        : "そろっていません。寝る前にそろえておくと朝がスムーズです。";
  }

  const p = challenge?.progress;
  const cells = document.querySelectorAll<HTMLElement>("#scramble .move");
  if (!p || !cells.length) return;

  net?.classList.toggle("off", !p.onTrack);

  cells.forEach((cell, i) => {
    cell.classList.toggle("done", i < p.done);
    cell.classList.toggle("current", i === p.done && p.onTrack);
    cell.classList.toggle("half", i === p.done && p.half && p.onTrack);
    cell.classList.toggle("stuck", i === p.done && !p.onTrack);
  });

  const fix = document.getElementById("fix")!;
  if (p.onTrack) {
    fix.innerHTML = "";
    fix.classList.remove("show");
  } else {
    fix.classList.add("show");
    fix.innerHTML = p.lost
      ? `<p class="fix-title">ずれました</p>
         <p class="fix-body">戻し方が追えなくなりました。キューブをそろえ直すと1手目からやり直せます。</p>`
      : `<p class="fix-title">ミス — この手順で戻せます</p>
         <div class="scramble fix-moves">${moveCells(p.fix)}</div>
         <p class="fix-body">戻したら ${p.done + 1}手目（${esc(challenge!.tracker!.moves[p.done] ?? "")}）から続けて</p>`;
  }

  const prog = document.getElementById("scr-progress");
  if (prog) {
    const total = challenge!.tracker!.moves.length;
    prog.textContent = p.onTrack
      ? `${p.done} / ${total} 手${p.half ? "（2回転の途中）" : ""} · 白上・緑前`
      : `${p.done} / ${total} 手で止まっています`;
  }
}

/* ------------------------------------------------------------------ */
/* event wiring                                                        */
/* ------------------------------------------------------------------ */

function update(patch: Partial<Settings>, rerender = true) {
  settings = { ...settings, ...patch };
  saveSettings(settings);
  if (rerender) render();
}

function on<T extends HTMLElement>(id: string, event: string, fn: (el: T) => void) {
  const node = document.getElementById(id) as T | null;
  if (node) node.addEventListener(event, () => fn(node));
}

function wire() {
  wireTimePicker(settings.alarmTime, (hhmm) => {
    update({ alarmTime: hhmm }, false);
    const desc = document.getElementById("alarm-desc");
    if (desc) desc.textContent = describeAlarm(hhmm);
  });

  on<HTMLSelectElement>("limitType", "change", (el) => update({ limitType: el.value as LimitType }));
  on<HTMLInputElement>("solves", "change", (el) =>
    update({ solves: clamp(el.value, 1, 20, DEFAULTS.solves) })
  );
  on<HTMLInputElement>("limitSeconds", "change", (el) =>
    update({ limitSeconds: clamp(el.value, 3, 600, DEFAULTS.limitSeconds) })
  );
  on<HTMLInputElement>("resetOnFail", "change", (el) => update({ resetOnFail: el.checked }));
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
  on("disconnect", "click", () => {
    void cube?.disconnect();
    cube = null;
    battery = null;
    render();
  });
  on("preview", "click", async () => {
    await unlockAudio(sound);
    await previewAlarm(settings.rampSeconds);
  });
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
        "手元のキューブが本当にそろっているときだけ押してください。いまの状態を「そろった」として記録し直します。"
      )
    ) {
      void cube?.reset();
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
