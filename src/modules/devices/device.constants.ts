export const MAX_DEVICE_ID_GENERATION_ATTEMPTS = 5;

// Canonical prefix for camera device IDs (e.g. CAM-793-MAU). Used to identify
// cameras reliably, since the stored deviceType field is inconsistent.
export const CAMERA_ID_PREFIX = 'CAM-';

// A camera counts as online if it reported its stream URL within this window.
// The board must report at least this often (on connect, on IP change, and as
// a heartbeat) for the online flag to stay accurate.
export const CAMERA_ONLINE_WINDOW_MS = 90_000;

export const BUTTON_HEARTBEAT_INTERVAL_MS = 30_000;
export const BUTTON_ONLINE_WINDOW_MS = 90_000;

export const DEVICE_EVENTS = {
  DEVICE_CREATED: 'device.created',
  DEVICE_ASSIGNED: 'device.assigned',
  DEVICE_ACTIVATED: 'device.activated',
  DEVICE_SECRET_ROTATED: 'device.secret.rotated',
  DEVICE_STREAM_URL_REPORTED: 'device.stream_url.reported',
  DEVICE_DISCONNECTED: 'device.disconnected',
} as const;

export const DEVICE_MESSAGES = {
  DEVICE_CREATED_MESSAGE: (deviceId: string) => `Device created with ID: ${deviceId}`,
  DEVICE_ASSIGNED_MESSAGE: (assignedUserId: string) => `Device assigned to user: ${assignedUserId}`,
  DEVICE_ACTIVATED_MESSAGE: (deviceId: string) => `Device activated with ID: ${deviceId}.`,
  DEVICE_SECRET_ROTATED_MESSAGE: (deviceId: string) => `Device secret rotated for ID: ${deviceId}`,
  DEVICE_STREAM_URL_REPORTED_MESSAGE: (deviceId: string) =>
    `Device reported stream URL for ID: ${deviceId}`,
  DEVICE_DISCONNECTED_MESSAGE: (deviceId: string) => `Device disconnected: ${deviceId}`,
} as const;

// Phone cameras. A session never runs longer than the max duration; the token
// stays valid for a short grace after it so a slow start does not cut the last
// frames. Presence comes from model-api heartbeats, not stream URL reports.
export const PHONE_SESSION_GRACE_MS = 30_000;
export const PHONE_PRESENCE_TIMEOUT_MS = 45_000;

export const PHONE_EVENTS = {
  PHONE_CAMERA_REGISTERED: 'device.phone.registered',
  PHONE_SESSION_STARTED: 'device.phone.session.started',
  PHONE_SESSION_ENDED: 'device.phone.session.ended',
} as const;
