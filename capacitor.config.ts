import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.dos.cubealarm",
  appName: "Cube Alarm",
  webDir: "dist",
  android: {
    // The alarm starts playing before anyone has touched the screen, so the
    // WebView must be allowed to make sound without a preceding gesture.
    allowMixedContent: false,
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: "キューブを探しています…",
        cancel: "キャンセル",
        availableDevices: "見つかったキューブ",
        noDeviceFound: "キューブが見つかりません",
      },
    },
  },
};

export default config;
