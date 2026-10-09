export const MAX_DEVICE_ID_GENERATION_ATTEMPTS = 5;

// A camera counts as online if it reported its stream URL within this window.
// The board must report at least this often (on connect, on IP change, and as
// a heartbeat) for the online flag to stay accurate.
export const CAMERA_ONLINE_WINDOW_MS = 90_000;

export const DEVICE_EVENTS = {
  DEVICE_CREATED: 'device.created',
  DEVICE_ASSIGNED: 'device.assigned',
  DEVICE_ACTIVATED: 'device.activated',
  DEVICE_SECRET_ROTATED: 'device.secret.rotated',
  DEVICE_STREAM_URL_REPORTED: 'device.stream_url.reported',
} as const;

export const DEVICE_MESSAGES = {
  DEVICE_CREATED_MESSAGE: (deviceId: string) => `Device created with ID: ${deviceId}`,
  DEVICE_ASSIGNED_MESSAGE: (assignedUserId: string) => `Device assigned to user: ${assignedUserId}`,
  DEVICE_ACTIVATED_MESSAGE: (deviceId: string) => `Device activated with ID: ${deviceId}.`,
  DEVICE_SECRET_ROTATED_MESSAGE: (deviceId: string) => `Device secret rotated for ID: ${deviceId}`,
  DEVICE_STREAM_URL_REPORTED_MESSAGE: (deviceId: string) =>
    `Device reported stream URL for ID: ${deviceId}`,
} as const;
