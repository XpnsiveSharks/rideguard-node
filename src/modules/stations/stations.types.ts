export type StationType = 'police' | 'barangay';
export type StationStatus = 'active' | 'inactive';
export type StationAvailability = 'available' | 'busy' | 'offline';
export type IncidentStatus = 'new' | 'acknowledged' | 'responding' | 'resolved';
export type NotificationReason = 'nearest' | 'barangay' | 'police' | 'escalation';

export type StationLocation = {
  latitude: number;
  longitude: number;
  capturedAt: string;
  accuracyMeters?: number | null;
};

export type Station = {
  id: string;
  name: string;
  type: StationType;
  latitude: number;
  longitude: number;
  status: StationStatus;
  availability: StationAvailability;
  coverageLabels: string[];
};

export type StationRecipient = {
  stationId: string;
  stationName: string;
  reasons: NotificationReason[];
  notifiedAt: string;
};

export type IncidentReadReceipt = {
  readAt: string;
  readByUid: string;
};

export type AuthorityIncident = {
  id: string;
  sosId: string;
  revision: number;
  receivedAt: string;
  status: IncidentStatus;
  location: StationLocation | null;
  locationSummary: string | null;
  coverage: {
    barangay: string | null;
    police: string | null;
  };
  notifiedRecipients: StationRecipient[];
  notifiedStationIds: string[];
  leadStationId: string | null;
  acknowledgedAt: string | null;
  acknowledgedByUid: string | null;
  readAt: string | null;
  readByUid: string | null;
  callbackNumber: string | null;
  riderName: string | null;
  vehicleSummary: string | null;
  emergencyContactSummary: string | null;
  reportSummary: string | null;
};

export type AuthorityIncidentPage = {
  data: AuthorityIncident[];
  nextCursor: string | null;
};

export type AuthorityIncidentDocument = Omit<AuthorityIncident, 'readAt' | 'readByUid'> & {
  readReceipts: Record<string, IncidentReadReceipt>;
};
