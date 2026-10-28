import type {
  Station,
  StationRecipient,
  NotificationReason,
  StationLocation,
} from './stations.types';

const EARTH_RADIUS_KM = 6371;

export function normalizeCoverageLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function haversineKm(start: StationLocation, end: Station): number {
  const latDistance = ((end.latitude - start.latitude) * Math.PI) / 180;
  const lngDistance = ((end.longitude - start.longitude) * Math.PI) / 180;
  const a =
    Math.sin(latDistance / 2) * Math.sin(latDistance / 2) +
    Math.cos((start.latitude * Math.PI) / 180) *
      Math.cos((end.latitude * Math.PI) / 180) *
      Math.sin(lngDistance / 2) *
      Math.sin(lngDistance / 2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function resolveStationRecipients({
  stations,
  location,
  coverageLabels,
  notifiedAt,
}: {
  stations: Station[];
  location: StationLocation;
  coverageLabels: string[];
  notifiedAt?: string;
}): StationRecipient[] {
  const eligible = stations.filter(
    (station) => station.status === 'active' && station.availability === 'available',
  );

  const normalizedCoverage = new Set(
    coverageLabels.map((label) => normalizeCoverageLabel(label)).filter(Boolean),
  );
  const recipients = new Map<string, StationRecipient>();
  const nearest = [...eligible].sort(
    (left, right) =>
      haversineKm(location, left) - haversineKm(location, right) ||
      left.name.localeCompare(right.name),
  )[0];

  const addRecipient = (station: Station, reason: NotificationReason) => {
    const existing = recipients.get(station.id);
    const notified = notifiedAt ?? new Date().toISOString();
    if (existing) {
      recipients.set(station.id, {
        ...existing,
        reasons: Array.from(new Set([...existing.reasons, reason])),
      });
      return;
    }
    recipients.set(station.id, {
      stationId: station.id,
      stationName: station.name,
      reasons: [reason],
      notifiedAt: notified,
    });
  };

  if (nearest) addRecipient(nearest, 'nearest');

  for (const station of eligible) {
    const coverageMatch = station.coverageLabels.some((label) =>
      normalizedCoverage.has(normalizeCoverageLabel(label)),
    );
    if (coverageMatch) {
      addRecipient(station, station.type === 'barangay' ? 'barangay' : 'police');
    }
  }

  return [...recipients.values()].sort((left, right) =>
    left.stationName.localeCompare(right.stationName),
  );
}
