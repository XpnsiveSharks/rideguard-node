export type SosStatus = 'active' | 'ended';

export type SubmissionStatus =
  'queued' | 'sending' | 'accepted' | 'failed' | 'unknown' | 'cancelled';

// `errorCode` is a safe machine code (never provider text).
export type SubmissionSummary = {
  status: SubmissionStatus;
  updatedAt: string;
  errorCode?: string;
  delivery?: DeliverySummary | null;
};
export type EmailSubmission = {
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'unknown';
  updatedAt: string;
  errorCode?: string;
};

export type LookupError = 'authentication_failed' | 'not_configured' | 'not_found' |
  'rate_limited' | 'timeout' | 'network_error' | 'server_error' | 'malformed_response' |
  'provider_unknown' | 'interrupted';
export type DeliverySummary = {
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'unknown';
  observedAt: string | null; acceptedAt: string; expiresAt: string;
  tracking: 'active' | 'complete' | 'timed_out' | 'unavailable';
  lastAttemptAt: string | null; lastCheckedAt: string | null;
  lastCheckError: LookupError | null; failureCode: string | null;
};
export type StatusRefresh = {
  state: 'idle' | 'pending' | 'complete' | 'partial' | 'unavailable';
  requestedAt: string | null; expiresAt: string | null; nextAllowedAt: string | null;
};
export const idleRefresh = (): StatusRefresh => ({ state: 'idle', requestedAt: null, expiresAt: null, nextAllowedAt: null });
export type MessageKind = 'initial' | 'ended';
export type DeliveryWork = {
  providerMessageId: string; deviceId: string; dueAt: number;
  revision: number; leaseUntil: number; failures: number;
};
export type RefreshTarget = { contactId: string; which: MessageKind; result: 'pending' | 'ok' | 'error' };

export type SosLocation = {
  latitude: number;
  longitude: number;
  capturedAt: string;
  accuracyMeters: number | null;
};

// Stored shape. `phone` stays backend-only; the API masks it.
export type SosRecipient = {
  contactId: string;
  name: string;
  phone: string;
  email: string;
  initialEmail?: EmailSubmission;
  endedEmail?: EmailSubmission | null;
  initial: SubmissionSummary;
  ended: SubmissionSummary | null;
  // Provider tracking id from the accepted initial send, for delivery checks.
  providerMessageId?: string;
  initialWork?: DeliveryWork;
  endedWork?: DeliveryWork;
};

export type SosRecord = {
  sosId: string;
  uid: string;
  requestId: string;
  // Absent on records created before alert linking was added.
  alertId?: string | null;
  status: SosStatus;
  // Display name used in messages, captured at activation.
  requesterName: string;
  createdAt: string;
  endedAt: string | null;
  location: SosLocation | null;
  recipients: SosRecipient[];
  statusRefresh?: StatusRefresh;
  refreshTargets?: RefreshTarget[];
  deliveryDueAt?: number | null;
  // Absent until the needsRecovery backfill runs on older records.
  needsRecovery?: boolean;
};

export type PublicSosRecipient = Omit<SosRecipient, 'phone' | 'providerMessageId' | 'initialWork' | 'endedWork'> & {
  phone: string;
};
export type PublicSos = Omit<SosRecord, 'uid' | 'recipients' | 'requesterName' | 'alertId' | 'refreshTargets' | 'deliveryDueAt' | 'needsRecovery'> & {
  alertId: string | null;
  recipients: PublicSosRecipient[];
};
