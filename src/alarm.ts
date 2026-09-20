/**
 * Alarm sound and screen wake lock.
 *
 * Two sources: a file the user picked, or a synthesized tone if they never
 * picked one. Both are routed through the same gain node, so the ramp from
 * quiet to full behaves identically either way — and setting gain in the
 * audio graph works on Android, where HTMLAudioElement.volume is unreliable.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let element: HTMLAudioElement | null = null;
let elementUrl: string | null = null;
let elementSource: MediaElementAudioSourceNode | null = null;
let oscillators: OscillatorNode[] = [];
let beatTimer: number | null = null;
let rampFrame = 0;
let ringing = false;

/** Volume the alarm starts at: quieter than full, never mistakable for silence. */
const FLOOR = 0.3;
const FULL = 1.0;

function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function masterGain(c: AudioContext): GainNode {
  if (!master) {
    master = c.createGain();
    master.gain.value = 0;
    master.connect(c.destination);
  }
  return master;
}

/**
 * Browsers only allow audio that a user gesture has unlocked. Call this from
 * the tap that arms the alarm, hours before it needs to make a sound.
 */
export async function unlockAudio(sound: Blob | undefined) {
  const c = audioContext();
  if (c.state === "suspended") await c.resume();
  const out = masterGain(c);

  // A single silent sample is enough to mark the context as user-activated.
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, 22050);
  src.connect(c.destination);
  src.start(0);

  if (sound) {
    if (elementUrl) URL.revokeObjectURL(elementUrl);
    elementSource?.disconnect();
    elementUrl = URL.createObjectURL(sound);
    element = new Audio(elementUrl);
    element.loop = true;
    element.preload = "auto";
    // Routing through the graph rather than element.volume, which Android
    // Chrome has historically ignored.
    elementSource = c.createMediaElementSource(element);
    elementSource.connect(out);
    try {
      await element.play();
      element.pause();
      element.currentTime = 0;
    } catch {
      /* will be retried when the alarm fires */
    }
  } else {
    element = null;
    elementSource = null;
  }
}

export const isRinging = () => ringing;

export async function startAlarm(rampSeconds: number) {
  if (ringing) return;
  ringing = true;
  const c = audioContext();
  if (c.state === "suspended") await c.resume();

  const out = masterGain(c);
  out.gain.cancelScheduledValues(c.currentTime);
  out.gain.setValueAtTime(FLOOR, c.currentTime);

  if (element) {
    element.currentTime = 0;
    try {
      await element.play();
    } catch {
      startTone(c); // playback refused, fall back to the tone
    }
  } else {
    startTone(c);
  }

  rampUp(rampSeconds);
}

/**
 * One linear ramp, driven from JavaScript rather than scheduled on the gain
 * parameter, because the tone's beat pattern also writes to that parameter
 * and would otherwise cancel a scheduled ramp on its first beat.
 */
function rampUp(rampSeconds: number) {
  cancelAnimationFrame(rampFrame);
  const started = performance.now();
  const step = () => {
    if (!ringing || !master || !ctx) return;
    const t =
      rampSeconds <= 0
        ? 1
        : Math.min(1, (performance.now() - started) / (rampSeconds * 1000));
    master.gain.setTargetAtTime(FLOOR + (FULL - FLOOR) * t, ctx.currentTime, 0.05);
    if (t < 1) rampFrame = requestAnimationFrame(step);
  };
  rampFrame = requestAnimationFrame(step);
}

function startTone(c: AudioContext) {
  // Two detuned squares: unpleasant on purpose, but not painful. The beat
  // pattern lives on its own gain node so it never fights the master ramp.
  const voice = c.createGain();
  voice.gain.value = 0.35;
  voice.connect(masterGain(c));

  oscillators = [880, 1174.7].map((f) => {
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    o.connect(voice);
    o.start();
    return o;
  });

  let on = true;
  beatTimer = window.setInterval(() => {
    on = !on;
    voice.gain.setTargetAtTime(on ? 0.35 : 0.0001, c.currentTime, 0.02);
  }, 420);
}

export function stopAlarm() {
  ringing = false;
  cancelAnimationFrame(rampFrame);
  if (element) {
    element.pause();
    element.currentTime = 0;
  }
  if (beatTimer !== null) {
    clearInterval(beatTimer);
    beatTimer = null;
  }
  oscillators.forEach((o) => {
    try {
      o.stop();
    } catch {
      /* already stopped */
    }
  });
  oscillators = [];
  if (master && ctx) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0, ctx.currentTime);
  }
}

/** Plays the chosen sound briefly so the volume can be checked before bed. */
export async function previewAlarm(rampSeconds: number, seconds = 4) {
  await startAlarm(rampSeconds);
  window.setTimeout(stopAlarm, seconds * 1000);
}

/** Short confirmation blip, used when a solve is accepted. */
export function blip(success: boolean) {
  const c = audioContext();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = success ? 1320 : 220;
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.25);
  o.connect(g);
  g.connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.3);
}

/* ---- keep the screen on while the alarm is armed ---- */

let lock: WakeLockSentinel | null = null;

export async function acquireWakeLock() {
  if (!("wakeLock" in navigator)) return false;
  try {
    lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => {
      lock = null;
    });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock() {
  try {
    await lock?.release();
  } catch {
    /* already gone */
  }
  lock = null;
}

/** Android drops the lock whenever the tab is backgrounded. */
export function keepWakeLockAlive(shouldHold: () => boolean) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && shouldHold() && !lock) {
      void acquireWakeLock();
    }
  });
}
