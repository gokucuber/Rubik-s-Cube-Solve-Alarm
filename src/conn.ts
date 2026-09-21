import { connectGanCube, type GanCubeConnection, type GanCubeEvent } from "gan-web-bluetooth";
import { SOLVED, applyMove } from "./cube.js";

export interface CubeHandle {
  name: string;
  mac: string;
  /** latest known cube state as a facelet string */
  state(): string;
  battery(): number | null;
  /** tell the cube its current physical state is solved */
  reset(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface CubeCallbacks {
  /**
   * A new cube state. `move` is the quarter turn that produced it, or null
   * when the state came from the cube's own full report (first sync, or a
   * correction after drift). `at` is a performance.now()-based timestamp.
   */
  onState(state: string, move: string | null, at: number): void;
  onBattery(level: number): void;
  onDisconnect(): void;
}

/** Called when the MAC cannot be read automatically and must be typed in. */
export type MacPrompt = (deviceName: string) => Promise<string | null>;

/** How long the cube must be still before its full report may override ours. */
const SETTLE_MS = 700;

export async function connectCube(
  cb: CubeCallbacks,
  knownMac: string | null,
  promptForMac: MacPrompt
): Promise<CubeHandle> {
  // The cube sends one event per quarter turn, not its whole state, so the
  // state is maintained here by applying each turn. The cube's own full
  // report is only used to start from, and to correct drift while idle.
  let state = SOLVED;
  let synced = false;
  let lastMoveAt = -Infinity;
  let battery: number | null = null;

  const conn: GanCubeConnection = await connectGanCube(
    async (device, isFallbackCall) => {
      // First pass: let the library try the advertisement API. Only step in
      // when it has given up, so a working automatic read is never blocked.
      if (!isFallbackCall) return knownMac;
      if (knownMac) return knownMac;
      return promptForMac(device.name ?? "GAN cube");
    }
  );

  conn.events$.subscribe((event: GanCubeEvent) => {
    switch (event.type) {
      case "MOVE": {
        if (!synced) return;
        const at = event.localTimestamp ?? performance.now();
        lastMoveAt = performance.now();
        state = applyMove(state, event.move);
        cb.onState(state, event.move, at);
        break;
      }
      case "FACELETS": {
        const settled = performance.now() - lastMoveAt > SETTLE_MS;
        if (!synced || (settled && event.facelets !== state)) {
          synced = true;
          state = event.facelets;
          cb.onState(state, null, performance.now());
        }
        break;
      }
      case "BATTERY":
        battery = event.batteryLevel;
        cb.onBattery(event.batteryLevel);
        break;
      case "DISCONNECT":
        cb.onDisconnect();
        break;
    }
  });

  await conn.sendCubeCommand({ type: "REQUEST_HARDWARE" });
  await conn.sendCubeCommand({ type: "REQUEST_BATTERY" });
  await conn.sendCubeCommand({ type: "REQUEST_FACELETS" });

  // Drift check only; turns themselves arrive as they happen.
  const poll = window.setInterval(() => {
    conn.sendCubeCommand({ type: "REQUEST_FACELETS" }).catch(() => {});
  }, 2000);

  return {
    name: conn.deviceName,
    mac: conn.deviceMAC,
    state: () => state,
    battery: () => battery,
    reset: async () => {
      await conn.sendCubeCommand({ type: "REQUEST_RESET" });
      state = SOLVED;
      cb.onState(state, null, performance.now());
    },
    disconnect: async () => {
      clearInterval(poll);
      await conn.disconnect();
    },
  };
}

export const bluetoothAvailable = () =>
  typeof navigator !== "undefined" && "bluetooth" in navigator;
