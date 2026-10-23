export const SOS_COLLECTION = 'sos';
// One doc per user pointing at their active SOS; reserved transactionally so
// two devices cannot both start one.
export const SOS_ACTIVE_COLLECTION = 'sos_active';
// Doc id `${uid}_${requestId}`; makes activation retries idempotent.
export const SOS_REQUESTS_COLLECTION = 'sos_requests';

// A location older than this at activation is treated as unavailable.
export const SOS_LOCATION_MAX_AGE_MS = 2 * 60 * 1000;
// A capture time further in the future than this is rejected.
export const SOS_LOCATION_MAX_FUTURE_MS = 60 * 1000;
// A job not submitted within this long of its creation is expired, never
// replayed late.
export const SOS_JOB_EXPIRY_MS = 2 * 60 * 1000;

export const SOS_TIME_ZONE = 'Asia/Manila';
export const SOS_MAX_NAME_LENGTH = 30;

// Seconds-scale budget for the post-accept delivery check.
export const SOS_DELIVERY_TRACK_TIMEOUT_MS = 60 * 1000;
