export const REALTIME_CHANNELS = {
  buttonEvents: 'rideguard:buttons:device',

  alerts: (userId: string, deviceId: string): string =>
    `rideguard:alerts:user:${encodeURIComponent(userId)}:device:${encodeURIComponent(deviceId)}`,

  alertsForUser: (userId: string): string =>
    `rideguard:alerts:user:${encodeURIComponent(userId)}:device:*`,

  sos: (userId: string): string =>
    `rideguard:sos:user:${encodeURIComponent(userId)}`,

  inferenceResults: 'rideguard-inference-results',

  captureImages: 'rideguard-capture-images',
} as const;

export const INFERENCE_EVENT_NAME = {
  inferenceResult: 'inference.result',
} as const;

export const CAPTURE_EVENT_NAME = {
  captureImage: 'capture.image',
  captureSkipped: 'capture.skipped',
} as const;

export const BUTTON_EVENT_NAMES = [
  'button.pressed',
  'button.press_started',
  'button.press_released',
] as const;

export const SOS_EVENTS = {
  SOS_UPDATED: 'sos.updated',
} as const;
