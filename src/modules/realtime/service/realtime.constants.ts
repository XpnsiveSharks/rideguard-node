export const REALTIME_CHANNELS = {
  alerts: (userId: string, deviceId: string): string =>
    `rideguard:alerts:user:${encodeURIComponent(userId)}:device:${encodeURIComponent(deviceId)}`,
} as const;
