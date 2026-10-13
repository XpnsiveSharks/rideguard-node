# Unused Code

## Camera `streamUrl`

- **Files:** `rideguard-node/src/modules/devices/`, `rideguard-mobile/src/modules/camera-sensor/`
- **Purpose:** Stores the camera's local MJPEG URL.
- **Current use:** Updates `lastSeenAt` and camera online status.
- **Not used for:** Mobile video playback.
- **Current playback path:** `rideguard-model-api /v1/stream/:device_id/live.mjpeg`
- **Remove when:** The backend no longer needs `streamUrl` for heartbeat or fallback playback.
- **Checked:** 2026-10-14
