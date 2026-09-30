// Result of registering a new device. - for manufacturers
export interface RegisterDeviceResult {
  deviceId: string;
  deviceSecret: string;
}

// Result of rotating a device secret. The new raw secret is returned once so
// staff can write it onto the ESP32; only its hash is stored.
export interface RotateDeviceSecretResult {
  deviceId: string;
  deviceSecret: string;
}
