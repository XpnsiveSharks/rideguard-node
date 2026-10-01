export const REALTIME_CHANNELS = {
  buttonEvents: (deviceId: string): string =>
    `rideguard:buttons:device:${encodeURIComponent(deviceId)}`,

  alerts: (userId: string, deviceId: string): string =>
    `rideguard:alerts:user:${encodeURIComponent(userId)}:device:${encodeURIComponent(deviceId)}`,

  alertsForUser: (userId: string): string =>
    `rideguard:alerts:user:${encodeURIComponent(userId)}:device:*`,
} as const;
