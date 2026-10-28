import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import type { AuthorityIncident, Station } from './stations.types';

type Data = Record<string, unknown>;

function makeFirestore(seed: Record<string, Data>) {
  const docs = new Map(Object.entries(seed));
  const ref = (name: string, id: string) => ({ id, path: `${name}/${id}` });
  const firestore = {
    collection: (name: string) => ({ doc: (id: string) => ref(name, id) }),
    runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>): Promise<T> => {
      const writes: [string, Data][] = [];
      const result = await callback({
        get: (r: { path: string }) => Promise.resolve({ data: () => docs.get(r.path) }),
        set: (r: { path: string }, data: Data) => writes.push([r.path, data]),
      });
      for (const [path, data] of writes) docs.set(path, { ...docs.get(path), ...data });
      return result;
    },
  };
  return { firestore: firestore as unknown as Firestore, docs };
}

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

const location = { latitude: 14.69, longitude: 121.09, capturedAt: '2026-10-29T01:00:00.000Z' };

function newIncident(): Data {
  return {
    sosId: 'sos-1',
    revision: 1,
    receivedAt: '2026-10-29T01:00:00.000Z',
    status: 'new',
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
  };
}

describe('StationsService', () => {
  it('deduplicates nearest and coverage recipients', () => {
    const service = new StationsService({} as Firestore);

    const recipients = service.resolveRecipients({
      stations: [stationA, stationB, stationC],
      location,
      coverageLabels: ['Commonwealth', 'Fairview'],
    });

    expect(recipients.map((recipient) => recipient.stationId)).toEqual(['station-a', 'station-b']);
    expect(recipients[0].reasons).toEqual(['nearest', 'barangay']);
    expect(recipients[1].reasons).toEqual(['police']);
  });

  it('names coverage from the routed barangay and police stations', () => {
    const service = new StationsService({} as Firestore);

    const incident = service.projectIncident({
      sosId: 'sos-1',
      location,
      coverageLabels: ['Commonwealth', 'Fairview'],
      stations: [stationA, stationB],
    });

    expect(incident.id).toBe('incident-sos-1');
    expect(incident.coverage).toEqual({
      barangay: 'Barangay Commonwealth',
      police: 'North Fairview Police Station',
    });
  });

  it('rejects missing locations before routing', () => {
    const service = new StationsService({} as Firestore);
    expect(() =>
      service.projectIncident({
        sosId: 'sos-no-location',
        location: null,
        coverageLabels: ['Commonwealth'],
        stations: [stationA],
      }),
    ).toThrow(BadRequestException);
  });

  it('lets the first recipient claim lead, replays it, and blocks another lead', async () => {
    const { firestore, docs } = makeFirestore({
      'authority_incidents/incident-1': newIncident(),
      'stations/station-a': { ...stationA },
      'stations/station-b': { ...stationB },
    });
    const service = new StationsService(firestore);
    const ack = (stationId: string) =>
      service.acknowledgeLead({ incidentId: 'incident-1', stationId, actorUid: 'operator-1' });

    const first = await ack('station-a');
    expect(first).toMatchObject({
      id: 'incident-1',
      status: 'acknowledged',
      leadStationId: 'station-a',
      acknowledgedByUid: 'operator-1',
      revision: 2,
    });

    const replay = await ack('station-a');
    expect(replay.revision).toBe(2);
    await expect(ack('station-b')).rejects.toBeInstanceOf(ConflictException);
    expect((docs.get('authority_incidents/incident-1') as AuthorityIncident).leadStationId).toBe(
      'station-a',
    );
  });

  it('refuses an unavailable or non-recipient station', async () => {
    const { firestore } = makeFirestore({
      'authority_incidents/incident-1': newIncident(),
      'stations/station-a': { ...stationA, availability: 'busy' },
      'stations/station-b': { ...stationB },
    });
    const service = new StationsService(firestore);
    const ack = (stationId: string) =>
      service.acknowledgeLead({ incidentId: 'incident-1', stationId, actorUid: 'operator-2' });

    await expect(ack('station-a')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ack('station-b')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('StationsController', () => {
  const acknowledgeLead = jest.fn();
  const controller = new StationsController({ acknowledgeLead } as unknown as StationsService);
  const request = (user: Data | undefined) =>
    ({ user, body: { stationId: 'station-b' } }) as unknown as Request;

  beforeEach(() => acknowledgeLead.mockReset());

  it('acknowledges as the station from the token claim only', async () => {
    await controller.acknowledgeIncident(
      request({ uid: 'operator-1', role: 'operator', stationId: 'station-a' }),
      'incident-1',
    );

    expect(acknowledgeLead).toHaveBeenCalledWith({
      incidentId: 'incident-1',
      stationId: 'station-a',
      actorUid: 'operator-1',
    });
  });

  it('rejects an operator without a station claim', async () => {
    await expect(
      controller.acknowledgeIncident(
        request({ uid: 'operator-1', role: 'operator' }),
        'incident-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(acknowledgeLead).not.toHaveBeenCalled();
  });
});
