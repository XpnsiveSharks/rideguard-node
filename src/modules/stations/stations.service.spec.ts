import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { StationsService } from './stations.service';
import type { Station } from './stations.types';

function makeFirestoreMock(incident: any, stationMap: Record<string, any>) {
  const docs = new Map<string, any>();
  for (const [path, data] of Object.entries(stationMap)) docs.set(path, data);
  const set = jest.fn((ref: { path: string }, next: any) => {
    if (ref.path === 'authority_incidents/incident-1') {
      Object.assign(incident, next);
    }
  });

  return {
    collection: jest.fn((name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        get: async () => {
          const snapshot = name === 'authority_incidents' ? incident : docs.get(`${name}/${id}`);
          return { data: () => snapshot };
        },
      }),
    })),
    runTransaction: jest.fn(async (cb: (tx: { get: (ref: { path: string }) => Promise<{ data: () => any }>; set: typeof set }) => Promise<any>) =>
      cb({
        get: async (ref: { path: string }) => {
          if (ref.path === 'authority_incidents/incident-1') return { data: () => incident };
          return { data: () => docs.get(ref.path) };
        },
        set,
      }),
    ),
  };
}

describe('StationsService', () => {
  const stationA: Station = {
    id: 'station-a',
    name: 'Barangay Commonwealth',
    type: 'barangay',
    latitude: 14.6934,
    longitude: 121.097,
    status: 'active',
    availability: 'available',
    coverageLabels: ['Commonwealth', 'Batasan Hills'],
  };

  const stationB: Station = {
    id: 'station-b',
    name: 'North Fairview Police Station',
    type: 'police',
    latitude: 14.709,
    longitude: 121.053,
    status: 'active',
    availability: 'available',
    coverageLabels: ['Fairview'],
  };

  const stationC: Station = {
    id: 'station-c',
    name: 'Off duty station',
    type: 'police',
    latitude: 14.6,
    longitude: 121.1,
    status: 'inactive',
    availability: 'available',
    coverageLabels: ['Commonwealth'],
  };

  it('deduplicates nearest and coverage recipients', () => {
    const service = new StationsService({} as any);
    const location = { latitude: 14.69, longitude: 121.09, capturedAt: '2026-10-29T01:00:00.000Z' };

    const recipients = service.resolveRecipients({
      stations: [stationA, stationB, stationC],
      location,
      coverageLabels: ['Commonwealth', 'Fairview'],
    });

    expect(recipients.map((recipient) => recipient.stationId)).toEqual([
      'station-a',
      'station-b',
    ]);
    expect(recipients.find((recipient) => recipient.stationId === 'station-a')?.reasons).toEqual([
      'nearest',
      'barangay',
    ]);
    expect(recipients.find((recipient) => recipient.stationId === 'station-b')?.reasons).toEqual([
      'police',
    ]);
  });

  it('allows the first valid acknowledgment and blocks a duplicate lead', async () => {
    const incident = {
      id: 'incident-1',
      sosId: 'sos-1',
      revision: 1,
      receivedAt: '2026-10-29T01:00:00.000Z',
      status: 'new',
      location: {
        latitude: 14.69,
        longitude: 121.09,
        capturedAt: '2026-10-29T00:59:00.000Z',
        accuracyMeters: 20,
      },
      locationSummary: 'Commonwealth Avenue',
      coverage: { barangay: 'Commonwealth', police: null },
      notifiedRecipients: [
        {
          stationId: 'station-a',
          stationName: 'Barangay Commonwealth',
          reasons: ['nearest'],
          notifiedAt: '2026-10-29T01:00:00.000Z',
        },
      ],
      leadStationId: null,
      acknowledgedAt: null,
      acknowledgedByUid: null,
      callbackNumber: null,
      riderName: null,
      vehicleSummary: null,
      emergencyContactSummary: null,
      reportSummary: null,
    };

    const firestore = makeFirestoreMock(incident, {
      'stations/station-a': {
        id: 'station-a',
        name: 'Barangay Commonwealth',
        type: 'barangay',
        latitude: 14.6934,
        longitude: 121.097,
        status: 'active',
        availability: 'available',
        coverageLabels: ['Commonwealth'],
      },
    });

    const service = new StationsService(firestore as any);
    const result = await service.acknowledgeLead({
      incidentId: 'incident-1',
      stationId: 'station-a',
      actorUid: 'operator-1',
    });

    expect(result.status).toBe('acknowledged');
    expect(result.leadStationId).toBe('station-a');

    const duplicate = service.acknowledgeLead({
      incidentId: 'incident-1',
      stationId: 'station-b',
      actorUid: 'operator-2',
    });

    await expect(duplicate).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects missing locations before project dispatch', () => {
    const service = new StationsService({} as any);
    expect(() =>
      service.projectIncident({
        sosId: 'sos-no-location',
        location: null,
        coverageLabels: ['Commonwealth'],
        stations: [stationA],
      }),
    ).toThrow(BadRequestException);
  });

  it('refuses an unavailable or non-recipient station', async () => {
    const incident = {
      id: 'incident-1',
      sosId: 'sos-1',
      revision: 1,
      status: 'new',
      notifiedRecipients: [{ stationId: 'station-a', stationName: 'Barangay Commonwealth', reasons: ['nearest'], notifiedAt: '2026-10-29T01:00:00.000Z' }],
      leadStationId: null,
      acknowledgedAt: null,
      acknowledgedByUid: null,
    };

    const firestore = makeFirestoreMock(incident, {
      'stations/station-b': {
        id: 'station-b',
        name: 'North Fairview Police Station',
        type: 'police',
        latitude: 14.709,
        longitude: 121.053,
        status: 'active',
        availability: 'busy',
        coverageLabels: ['Fairview'],
      },
    });

    const service = new StationsService(firestore as any);

    await expect(
      service.acknowledgeLead({ incidentId: 'incident-1', stationId: 'station-b', actorUid: 'operator-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
