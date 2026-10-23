export type SosStatus = 'active' | 'ended';

export type SubmissionStatus =
  'queued' | 'sending' | 'accepted' | 'failed' | 'unknown' | 'cancelled';

// `errorCode` is a safe machine code (never provider text).
export type SubmissionSummary = {
  status: SubmissionStatus;
  updatedAt: string;
  errorCode?: string;
};

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
  initial: SubmissionSummary;
  ended: SubmissionSummary | null;
  // Provider tracking id from the accepted initial send, for delivery checks.
  providerMessageId?: string;
};

export type SosRecord = {
  sosId: string;
  uid: string;
  requestId: string;
  status: SosStatus;
  // Display name used in messages, captured at activation.
  requesterName: string;
  createdAt: string;
  endedAt: string | null;
  location: SosLocation | null;
  recipients: SosRecipient[];
};

export type PublicSosRecipient = Omit<SosRecipient, 'phone' | 'providerMessageId'> & {
  phone: string;
};
export type PublicSos = Omit<SosRecord, 'uid' | 'recipients' | 'requesterName'> & {
  recipients: PublicSosRecipient[];
};
