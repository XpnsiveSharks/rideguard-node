export const REALTIME_CHANNELS = {
  alerts: (userId: string, deviceId: string): string =>
    `rideguard:alerts:user:${encodeURIComponent(userId)}:device:${encodeURIComponent(deviceId)}`,

  alertsForUser: (userId: string): string =>
    `rideguard:alerts:user:${encodeURIComponent(userId)}:device:*`,
} as const;
