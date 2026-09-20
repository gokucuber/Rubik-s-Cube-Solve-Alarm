export type LimitType = "none" | "perSolve" | "total";

export interface Settings {
  /** "HH:MM" in local time */
  alarmTime: string;
  /** how many solves are required to stop the alarm */
  solves: number;
  limitType: LimitType;
  /** seconds; meaning depends on limitType */
  limitSeconds: number;
  /** on a failed solve, start the count over instead of retrying just that solve */
  resetOnFail: boolean;
  scrambleLength: number;
  /** seconds taken for the alarm to reach full volume */
  rampSeconds: number;
  /** remembered so the cube can be identified without asking again */
  cubeMac: string | null;
  soundName: string | null;
}

export const DEFAULTS: Settings = {
  alarmTime: "07:00",
  solves: 1,
  limitType: "none",
  limitSeconds: 20,
  resetOnFail: true,
  scrambleLength: 22,
  rampSeconds: 8,
  cubeMac: null,
  soundName: null,
};

const KEY = "cube-alarm.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode; settings just won't persist */
  }
}

/* ---- alarm sound, kept as a Blob so it survives a reload ---- */

const DB_NAME = "cube-alarm";
const STORE = "audio";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export const saveSound = (blob: Blob) =>
  tx<void>("readwrite", (s) => s.put(blob, "alarm"));

export const loadSound = () =>
  tx<Blob | undefined>("readonly", (s) => s.get("alarm")).catch(() => undefined);

export const clearSound = () =>
  tx<void>("readwrite", (s) => s.delete("alarm")).catch(() => undefined);
