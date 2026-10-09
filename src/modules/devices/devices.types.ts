import type { TokenDetails } from 'ably';

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
export interface DevicePublisherTokenResult extends TokenDetails {
  channel: string;
}

// One camera as the mobile app sees it. stream_url is null until the board has
// reported one; online reflects whether it reported recently.
export interface CameraView {
  device_id: string;
  stream_url: string | null;
  online: boolean;
  last_seen_at: string | null;
}
