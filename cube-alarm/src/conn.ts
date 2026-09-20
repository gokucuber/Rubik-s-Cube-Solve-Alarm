import { connectGanCube, type GanCubeConnection, type GanCubeEvent } from "gan-web-bluetooth";
import { SOLVED } from "./cube.js";

export interface CubeHandle {
  name: string;
  mac: string;
  /** latest facelet string the cube reports */
  facelets(): string;
  battery(): number | null;
  /** tell the cube its current physical state is solved */
  reset(): Promise<void>;
  askFacelets(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface CubeCallbacks {
  onFacelets(facelets: string): void;
  onMove(move: string, at: number): void;
  onBattery(level: number): void;
  onDisconnect(): void;
}

/** Called when the MAC cannot be read automatically and must be typed in. */
export type MacPrompt = (deviceName: string) => Promise<string | null>;

export async function connectCube(
  cb: CubeCallbacks,
  knownMac: string | null,
  promptForMac: MacPrompt
): Promise<CubeHandle> {
  let facelets = SOLVED;
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
      case "FACELETS":
        facelets = event.facelets;
        cb.onFacelets(event.facelets);
        break;
      case "MOVE":
        cb.onMove(event.move, event.localTimestamp ?? performance.now());
        break;
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

  // The cube pushes a facelet event on every turn, but a dropped BLE packet
  // would leave us out of step. Polling closes that gap cheaply.
  const poll = window.setInterval(() => {
    conn.sendCubeCommand({ type: "REQUEST_FACELETS" }).catch(() => {});
  }, 1000);

  return {
    name: conn.deviceName,
    mac: conn.deviceMAC,
    facelets: () => facelets,
    battery: () => battery,
    reset: () => conn.sendCubeCommand({ type: "REQUEST_RESET" }),
    askFacelets: () => conn.sendCubeCommand({ type: "REQUEST_FACELETS" }),
    disconnect: async () => {
      clearInterval(poll);
      await conn.disconnect();
    },
  };
}

export const bluetoothAvailable = () =>
  typeof navigator !== "undefined" && "bluetooth" in navigator;
