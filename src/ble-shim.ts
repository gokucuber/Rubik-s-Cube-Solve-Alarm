/**
 * A `navigator.bluetooth` implementation backed by the Capacitor BLE plugin.
 *
 * Android's WebView has no Web Bluetooth, so inside the packaged app the
 * browser API is missing. Rather than reimplement the GAN protocol natively,
 * this provides the small slice of Web Bluetooth that gan-web-bluetooth
 * actually uses, so every line of the protocol handling stays shared with
 * the web build.
 *
 * Only what the library calls is implemented: one device, service discovery,
 * one notify characteristic, one write characteristic, disconnect events.
 */

import { BleClient, type BleService } from "@capacitor-community/bluetooth-le";

type Listener = (event: unknown) => void;

/** Minimal event target, since the library subscribes with addEventListener. */
class Emitter {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type: string, event: unknown) {
    this.listeners.get(type)?.forEach((fn) => fn(event));
  }
}

class ShimCharacteristic extends Emitter {
  value: DataView | null = null;
  constructor(
    private deviceId: string,
    private service: string,
    readonly uuid: string,
    private writeWithoutResponse: boolean
  ) {
    super();
  }

  async startNotifications() {
    await BleClient.startNotifications(this.deviceId, this.service, this.uuid, (value) => {
      this.value = value;
      // The library reads event.target.value, matching the DOM shape.
      this.emit("characteristicvaluechanged", { target: this });
    });
    return this;
  }

  async stopNotifications() {
    await BleClient.stopNotifications(this.deviceId, this.service, this.uuid);
    return this;
  }

  async readValue(): Promise<DataView> {
    this.value = await BleClient.read(this.deviceId, this.service, this.uuid);
    return this.value;
  }

  async writeValue(data: BufferSource) {
    const view =
      data instanceof DataView
        ? data
        : new DataView(
            (data as ArrayBufferView).buffer ?? (data as ArrayBuffer),
            (data as ArrayBufferView).byteOffset ?? 0,
            (data as ArrayBufferView).byteLength ?? (data as ArrayBuffer).byteLength
          );
    if (this.writeWithoutResponse) {
      await BleClient.writeWithoutResponse(this.deviceId, this.service, this.uuid, view);
    } else {
      await BleClient.write(this.deviceId, this.service, this.uuid, view);
    }
  }
}

class ShimService {
  constructor(private deviceId: string, private info: BleService) {}
  get uuid() {
    return this.info.uuid;
  }
  async getCharacteristic(uuid: string) {
    const found = this.info.characteristics.find(
      (c) => c.uuid.toLowerCase() === uuid.toLowerCase()
    );
    if (!found) throw new Error(`characteristic ${uuid} not found`);
    const noResponse = !found.properties.write && !!found.properties.writeWithoutResponse;
    return new ShimCharacteristic(this.deviceId, this.info.uuid, found.uuid, noResponse);
  }
}

class ShimGatt {
  connected = false;
  private services: ShimService[] = [];
  constructor(private device: ShimDevice) {}

  async connect() {
    await BleClient.connect(this.device.id, () => {
      this.connected = false;
      this.device.emit("gattserverdisconnected", { target: this.device });
    });
    this.connected = true;
    const found = await BleClient.getServices(this.device.id);
    this.services = found.map((s) => new ShimService(this.device.id, s));
    return this;
  }

  async getPrimaryServices() {
    return this.services;
  }

  async getPrimaryService(uuid: string) {
    const found = this.services.find((s) => s.uuid.toLowerCase() === uuid.toLowerCase());
    if (!found) throw new Error(`service ${uuid} not found`);
    return found;
  }

  disconnect() {
    this.connected = false;
    void BleClient.disconnect(this.device.id);
  }
}

class ShimDevice extends Emitter {
  gatt: ShimGatt;
  /**
   * On Android the plugin's device id is the MAC address, which is exactly
   * what the GAN encryption salt needs — so the packaged app never has to
   * ask the user to type it in.
   */
  constructor(readonly id: string, readonly name: string) {
    super();
    this.gatt = new ShimGatt(this);
  }
}

interface RequestOptions {
  filters?: { namePrefix?: string; name?: string }[];
  optionalServices?: string[];
}

/**
 * Installs the shim on `navigator`. Does nothing in a real browser, where
 * Web Bluetooth already exists and is the better implementation.
 */
export async function installBluetoothShim() {
  if ("bluetooth" in navigator) return;
  await BleClient.initialize({ androidNeverForLocation: true });

  const bluetooth = {
    getAvailability: async () => true,
    async requestDevice(options: RequestOptions) {
      // The plugin's picker takes a single name prefix, unlike Web
      // Bluetooth's list of filters, so the first one is used.
      const namePrefix = options.filters?.find((f) => f.namePrefix)?.namePrefix;
      const device = await BleClient.requestDevice({
        namePrefix,
        optionalServices: options.optionalServices,
      });
      return new ShimDevice(device.deviceId, device.name ?? namePrefix ?? "GAN cube");
    },
  };

  Object.defineProperty(navigator, "bluetooth", { value: bluetooth, configurable: true });
}

/** A MAC-shaped device id, or null if this is not the packaged app. */
export function macFromDevice(device: unknown): string | null {
  const id = (device as { id?: string })?.id ?? "";
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(id) ? id.toUpperCase() : null;
}
