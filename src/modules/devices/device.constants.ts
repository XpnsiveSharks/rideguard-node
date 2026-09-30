export const MAX_DEVICE_ID_GENERATION_ATTEMPTS = 5;

export const DEVICE_EVENTS = {
  DEVICE_CREATED: 'device.created',
  DEVICE_ASSIGNED: 'device.assigned',
  DEVICE_ACTIVATED: 'device.activated',
  DEVICE_SECRET_ROTATED: 'device.secret.rotated',
} as const;

export const DEVICE_MESSAGES = {
  DEVICE_CREATED_MESSAGE: (deviceId: string) => `Device created with ID: ${deviceId}`,
  DEVICE_ASSIGNED_MESSAGE: (assignedUserId: string) => `Device assigned to user: ${assignedUserId}`,
  DEVICE_ACTIVATED_MESSAGE: (deviceId: string) => `Device activated with ID: ${deviceId}.`,
  DEVICE_SECRET_ROTATED_MESSAGE: (deviceId: string) => `Device secret rotated for ID: ${deviceId}`,
} as const;
