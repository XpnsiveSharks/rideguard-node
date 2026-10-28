import type { TokenDetails } from 'ably';
import type { DeviceSource } from './domain/device.entity';

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
// reported one; online reflects whether it reported recently. Phone cameras
// have no stream URL; online reflects model-api presence during a session.
export interface CameraView {
  device_id: string;
  source: DeviceSource;
  stream_url: string | null;
  online: boolean;
  last_seen_at: string | null;
}

export interface PhoneCameraView {
  device_id: string;
  source: DeviceSource.PHONE;
  created: boolean;
}

// upload_token is a one-time secret. It is shown here once and never stored.
export interface PhoneSessionView {
  session_id: string;
  device_id: string;
  upload_token: string;
  duration_ms: number;
  started_at: string;
  expires_at: string;
}

export interface VerifiedPhoneUpload {
  device_id: string;
  session_id: string;
  expires_at: string;
}

export interface DisconnectedDeviceItem {
  device_id: string;
  device_type: string;
  status: 'disconnected';
}

export interface DisconnectDeviceResult {
  disconnected: string[];
  devices: DisconnectedDeviceItem[];
}
