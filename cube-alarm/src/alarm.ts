/**
 * Alarm sound and screen wake lock.
 *
 * Two sources: a file the user picked, or a synthesized tone if they never
 * picked one. Both ramp from quiet to full over `rampSeconds` so the wake-up
 * is less brutal, and both loop until something explicitly stops them.
 */

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let element: HTMLAudioElement | null = null;
let elementUrl: string | null = null;
let oscillators: OscillatorNode[] = [];
let beatTimer: number | null = null;
let ringing = false;

function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/**
 * Browsers only allow audio that a user gesture has unlocked. Call this from
 * the tap that arms the alarm, hours before it needs to make a sound.
 */
export async function unlockAudio(sound: Blob | undefined) {
  const c = audioContext();
  if (c.state === "suspended") await c.resume();
  // A single silent sample is enough to mark the context as user-activated.
  const buf = c.createBuffer(1, 1, 22050);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start(0);

  if (sound) {
    if (elementUrl) URL.revokeObjectURL(elementUrl);
    elementUrl = URL.createObjectURL(sound);
    element = new Audio(elementUrl);
    element.loop = true;
    element.volume = 0;
    try {
      await element.play();
      element.pause();
      element.currentTime = 0;
    } catch {
      /* will be retried when the alarm fires */
    }
  } else {
    element = null;
  }
}

export function isRinging() {
  return ringing;
}

export async function startAlarm(rampSeconds: number) {
  if (ringing) return;
  ringing = true;
  const c = audioContext();
  if (c.state === "suspended") await c.resume();

  if (element) {
    element.volume = 0.05;
    element.currentTime = 0;
    try {
      await element.play();
    } catch {
      startTone(c, rampSeconds); // playback refused, fall back to the tone
      return;
    }
    const started = performance.now();
    const ramp = () => {
      if (!ringing || !element) return;
      const t = Math.min(1, (performance.now() - started) / (rampSeconds * 1000));
      element.volume = 0.05 + 0.95 * t * t;
      if (t < 1) requestAnimationFrame(ramp);
    };
    requestAnimationFrame(ramp);
  } else {
    startTone(c, rampSeconds);
  }
}

function startTone(c: AudioContext, rampSeconds: number) {
  gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.35, c.currentTime + rampSeconds);
  gain.connect(c.destination);

  // Two detuned squares: unpleasant on purpose, but not painful.
  oscillators = [880, 1174.7].map((f) => {
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    o.connect(gain!);
    o.start();
    return o;
  });

  // Chop it into a beeping pattern rather than a continuous drone.
  let on = true;
  beatTimer = window.setInterval(() => {
    if (!gain) return;
    on = !on;
    gain.gain.setTargetAtTime(on ? 0.35 : 0.0001, c.currentTime, 0.02);
  }, 420);
}

export function stopAlarm() {
  ringing = false;
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
  gain?.disconnect();
  gain = null;
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
