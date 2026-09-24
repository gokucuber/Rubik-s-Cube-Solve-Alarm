/**
 * The bridge to the packaged Android app. Everything here degrades to a no-op
 * in the browser, so one codebase serves both builds.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

export const isNative = () => Capacitor.isNativePlatform();

interface CubeAlarmPlugin {
  /** Wake the app at `at` (epoch ms), even from doze. */
  schedule(options: { at: number }): Promise<void>;
  cancel(): Promise<void>;
  /** Android 12+ requires the user to grant exact alarms explicitly. */
  canScheduleExact(): Promise<{ granted: boolean }>;
  requestExactPermission(): Promise<void>;
  /** Android 14+ gates the full-screen alarm UI behind its own permission. */
  canUseFullScreen(): Promise<{ granted: boolean }>;
  requestFullScreenPermission(): Promise<void>;
}

const CubeAlarm = registerPlugin<CubeAlarmPlugin>("CubeAlarm");

export async function installNativeBluetooth() {
  if (!isNative()) return;
  const { installBluetoothShim } = await import("./ble-shim.js");
  await installBluetoothShim();
}

export async function scheduleNativeAlarm(at: number) {
  if (!isNative()) return;
  try {
    await CubeAlarm.schedule({ at });
  } catch (err) {
    console.error("could not schedule the native alarm", err);
  }
}

export async function cancelNativeAlarm() {
  if (!isNative()) return;
  try {
    await CubeAlarm.cancel();
  } catch {
    /* nothing scheduled */
  }
}

export interface PermissionState {
  exact: boolean;
  fullScreen: boolean;
}

/** Both permissions are needed before the alarm can wake a locked phone. */
export async function checkPermissions(): Promise<PermissionState | null> {
  if (!isNative()) return null;
  const [exact, fullScreen] = await Promise.all([
    CubeAlarm.canScheduleExact().catch(() => ({ granted: false })),
    CubeAlarm.canUseFullScreen().catch(() => ({ granted: false })),
  ]);
  return { exact: exact.granted, fullScreen: fullScreen.granted };
}

export const requestExactAlarms = () => CubeAlarm.requestExactPermission();
export const requestFullScreen = () => CubeAlarm.requestFullScreenPermission();
