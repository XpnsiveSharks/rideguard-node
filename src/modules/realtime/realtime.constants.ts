export const REALTIME_CHANNELS = {
  buttonEvents: 'rideguard:buttons:device',

  alerts: (userId: string, deviceId: string): string =>
    `rideguard:alerts:user:${encodeURIComponent(userId)}:device:${encodeURIComponent(deviceId)}`,

  alertsForUser: (userId: string): string =>
    `rideguard:alerts:user:${encodeURIComponent(userId)}:device:*`,

  inferenceResults: 'rideguard-inference-results',
} as const;

export const INFERENCE_EVENT_NAME = {
  inferenceResult: 'inference.result',
} as const;

export const BUTTON_EVENT_NAMES = [
  'button.pressed',
  'button.press_started',
  'button.press_released',
] as const;
