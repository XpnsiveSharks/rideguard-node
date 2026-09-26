export const MAX_DEVICE_ID_GENERATION_ATTEMPTS = 5;

export const DEVICE_EVENTS = {
  DEVICE_CREATED: 'device.created',
  DEVICE_ASSIGNED: 'device.assigned',
  DEVICE_ACTIVATED: 'device.activated',
} as const;

export const DEVICE_MESSAGES = {
  DEVICE_CREATED_MESSAGE: (deviceId: string) => `Device created with ID: ${deviceId}`,
  DEVICE_ASSIGNED_MESSAGE: (assignedUserId: string) => `Device assigned to user: ${assignedUserId}`,
  DEVICE_ACTIVATED_MESSAGE: (deviceId: string) => `Device activated with ID: ${deviceId}.`,
} as const;
