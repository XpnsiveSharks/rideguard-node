import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import type { AuthorityIncident, AuthorityIncidentDocument, Station } from './stations.types';

type Data = Record<string, unknown>;

function makeFirestore(seed: Record<string, Data>) {
  const docs = new Map(Object.entries(seed));
  const ref = (name: string, id: string) => {
    const path = `${name}/${id}`;
    return {
      id,
      path,
      get: () => Promise.resolve({ id, exists: docs.has(path), data: () => docs.get(path) }),
      update: (data: Data) => {
        if (!docs.has(path)) {
          return Promise.reject(Object.assign(new Error('not found'), { code: 5 }));
        }
        docs.set(path, { ...docs.get(path), ...data });
        return Promise.resolve();
      },
      create: (data: Data) => {
        if (docs.has(path)) return Promise.reject(Object.assign(new Error('exists'), { code: 6 }));
        docs.set(path, data);
        return Promise.resolve();
      },
    };
  };
  const query = (
    name: string,
    filters: Array<{ field: string; value: unknown }> = [],
    max?: number,
    afterId?: string,
  ): Data => ({
    where: (field: string, operator: string, value: unknown) => {
      if (operator !== 'array-contains') throw new Error(`Unsupported operator: ${operator}`);
      return query(name, [...filters, { field, value }], max, afterId);
    },
    orderBy: () => query(name, filters, max, afterId),
    limit: (value: number) => query(name, filters, value, afterId),
    startAfter: (snapshot: { id: string }) => query(name, filters, max, snapshot.id),
    get: () => {
      let entries = [...docs.entries()]
        .filter(([path]) => path.startsWith(`${name}/`))
        .filter(([, data]) =>
          filters.every(({ field, value }) => {
            const fieldValue = data[field];
            return Array.isArray(fieldValue) && fieldValue.includes(value);
          }),
        )
        .sort(([leftPath, left], [rightPath, right]) => {
          const receivedAtOrder = String(right.receivedAt).localeCompare(String(left.receivedAt));
          return receivedAtOrder || rightPath.localeCompare(leftPath);
        });
      if (afterId) {
        const cursorIndex = entries.findIndex(([path]) => path === `${name}/${afterId}`);
        entries = cursorIndex < 0 ? [] : entries.slice(cursorIndex + 1);
      }
      if (max !== undefined) entries = entries.slice(0, max);
      return Promise.resolve({
        empty: entries.length === 0,
        docs: entries.map(([path, data]) => ({
          id: path.slice(name.length + 1),
          data: () => data,
        })),
      });
    },
  });
  const firestore = {
    collection: (name: string) => ({
      ...query(name),
      doc: (id: string) => ref(name, id),
    }),
    runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>): Promise<T> => {
      const writes: [string, Data][] = [];
      const result = await callback({
        get: (r: { id: string; path: string }) =>
          Promise.resolve({ id: r.id, exists: docs.has(r.path), data: () => docs.get(r.path) }),
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
    notifiedStationIds: ['station-a'],
    leadStationId: null,
    acknowledgedAt: null,
    acknowledgedByUid: null,
    readReceipts: {},
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
    expect(incident.readReceipts).toEqual({});
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

  it('persists an SOS incident routed to the nearest available station, once', async () => {
    const { firestore, docs } = makeFirestore({
      'stations/station-a': { ...stationA },
      'stations/station-b': { ...stationB },
      'stations/station-c': { ...stationC },
    });
    const service = new StationsService(firestore);
    const input = {
      sosId: 'sos-1',
      location,
      riderName: 'Maria Santos',
      receivedAt: '2026-10-29T01:00:00.000Z',
    };

    await expect(service.openIncidentForSos(input)).resolves.toBe('created');
    const stored = docs.get('authority_incidents/incident-sos-1') as AuthorityIncident;
    expect(stored.notifiedRecipients.map((r) => [r.stationId, r.reasons])).toEqual([
      ['station-a', ['nearest']],
    ]);
    expect(stored).toMatchObject({ status: 'new', riderName: 'Maria Santos', leadStationId: null });
    expect(stored.readReceipts).toEqual({});

    await expect(service.openIncidentForSos(input)).resolves.toBe('exists');
  });

  it('writes no incident when no station is available', async () => {
    const { firestore, docs } = makeFirestore({ 'stations/station-c': { ...stationC } });
    const service = new StationsService(firestore);
    await expect(
      service.openIncidentForSos({
        sosId: 'sos-2',
        location,
        riderName: null,
        receivedAt: '2026-10-29T01:00:00.000Z',
      }),
    ).resolves.toBe('no_stations');
    expect(docs.has('authority_incidents/incident-sos-2')).toBe(false);
  });

  it('lists all stations', async () => {
    const { firestore } = makeFirestore({
      'stations/station-a': { ...stationA },
      'stations/station-b': { ...stationB },
      'stations/station-c': { ...stationC },
    });
    const service = new StationsService(firestore);
    const stations = await service.listStations();
    expect(stations.map((s) => s.id).sort()).toEqual(['station-a', 'station-b', 'station-c']);
  });

  it('lists incidents filtered by stationId', async () => {
    const { firestore } = makeFirestore({
      'authority_incidents/incident-1': {
        ...newIncident(),
        notifiedRecipients: [
          {
            stationId: 'station-a',
            stationName: 'Barangay Commonwealth',
            reasons: ['nearest'],
            notifiedAt: '2026-10-29T01:00:00.000Z',
          },
        ],
      },
      'authority_incidents/incident-2': {
        ...newIncident(),
        sosId: 'sos-2',
        notifiedStationIds: ['station-b'],
        notifiedRecipients: [
          {
            stationId: 'station-b',
            stationName: 'North Fairview Police Station',
            reasons: ['police'],
            notifiedAt: '2026-10-29T01:00:00.000Z',
          },
        ],
      },
      'authority_incidents/incident-stale-index': {
        ...newIncident(),
        sosId: 'sos-stale-index',
        notifiedStationIds: ['station-a'],
        notifiedRecipients: [
          {
            stationId: 'station-b',
            stationName: 'North Fairview Police Station',
            reasons: ['police'],
            notifiedAt: '2026-10-29T01:00:00.000Z',
          },
        ],
      },
    });
    const service = new StationsService(firestore);

    const stationAIncidents = await service.listIncidents('station-a', 50);
    expect(stationAIncidents.data.map((i) => i.sosId)).toEqual(['sos-1']);
    expect(stationAIncidents.nextCursor).toBeNull();

    const stationBIncidents = await service.listIncidents('station-b', 50);
    expect(stationBIncidents.data.map((i) => i.sosId)).toEqual(['sos-2']);

    const stationCIncidents = await service.listIncidents('station-c', 50);
    expect(stationCIncidents.data).toEqual([]);
  });

  it('paginates incidents and normalizes legacy read fields', async () => {
    const legacy = newIncident();
    delete legacy.readReceipts;
    const { firestore } = makeFirestore({
      'authority_incidents/incident-stale-index': {
        ...legacy,
        sosId: 'sos-stale-index',
        receivedAt: '2026-10-29T03:00:00.000Z',
        notifiedRecipients: [
          {
            stationId: 'station-b',
            stationName: 'North Fairview Police Station',
            reasons: ['police'],
            notifiedAt: '2026-10-29T03:00:00.000Z',
          },
        ],
      },
      'authority_incidents/incident-2': {
        ...legacy,
        sosId: 'sos-2',
        receivedAt: '2026-10-29T02:00:00.000Z',
      },
      'authority_incidents/incident-1': legacy,
    });
    const service = new StationsService(firestore);

    const first = await service.listIncidents('station-a', 1);
    expect(first.data).toHaveLength(1);
    expect(first.data[0]).toMatchObject({ sosId: 'sos-2', readAt: null, readByUid: null });
    expect(first.nextCursor).toBe('incident-2');

    const second = await service.listIncidents('station-a', 1, first.nextCursor!);
    expect(second.data.map((incident) => incident.sosId)).toEqual(['sos-1']);
    expect(second.nextCursor).toBeNull();
  });

  it('marks an incident as read', async () => {
    const current = { ...newIncident(), status: 'responding', revision: 4 };
    const { firestore, docs } = makeFirestore({
      'authority_incidents/incident-1': current,
    });
    const service = new StationsService(firestore);

    const updated = await service.markIncidentRead('incident-1', 'station-a', 'operator-1');

    expect(updated.readAt).not.toBeNull();
    expect(updated.readByUid).toBe('operator-1');
    expect(updated.status).toBe('responding');
    expect(updated.revision).toBe(5);

    const stored = docs.get('authority_incidents/incident-1') as AuthorityIncidentDocument;
    expect(stored.readReceipts['station-a'].readAt).toBe(updated.readAt);
    expect(stored.readReceipts['station-a'].readByUid).toBe('operator-1');
  });

  it('keeps read receipts independent for each notified station', async () => {
    const incident = {
      ...newIncident(),
      notifiedStationIds: ['station-a', 'station-b'],
      notifiedRecipients: [
        ...(newIncident().notifiedRecipients as Data[]),
        {
          stationId: 'station-b',
          stationName: 'North Fairview Police Station',
          reasons: ['police'],
          notifiedAt: '2026-10-29T01:00:00.000Z',
        },
      ],
    };
    const { firestore, docs } = makeFirestore({
      'authority_incidents/incident-1': incident,
    });
    const service = new StationsService(firestore);

    await service.markIncidentRead('incident-1', 'station-a', 'operator-a');
    const stationA = await service.listIncidents('station-a', 50);
    const stationBBeforeRead = await service.listIncidents('station-b', 50);
    expect(stationA.data[0].readByUid).toBe('operator-a');
    expect(stationBBeforeRead.data[0]).toMatchObject({ readAt: null, readByUid: null });

    await service.markIncidentRead('incident-1', 'station-b', 'operator-b');
    const stored = docs.get('authority_incidents/incident-1') as AuthorityIncidentDocument;
    expect(Object.keys(stored.readReceipts).sort()).toEqual(['station-a', 'station-b']);
    expect(stored.readReceipts['station-a'].readByUid).toBe('operator-a');
    expect(stored.readReceipts['station-b'].readByUid).toBe('operator-b');
  });

  it('refuses a station that was not notified to mark an incident read', async () => {
    const { firestore } = makeFirestore({
      'authority_incidents/incident-1': {
        ...newIncident(),
        notifiedStationIds: ['station-a', 'station-b'],
      },
    });
    const service = new StationsService(firestore);

    await expect(
      service.markIncidentRead('incident-1', 'station-b', 'operator-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFoundException when marking a missing incident read', async () => {
    const { firestore } = makeFirestore({});
    const service = new StationsService(firestore);
    await expect(
      service.markIncidentRead('incident-missing', 'station-a', 'operator-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('StationsController', () => {
  const acknowledgeLead = jest.fn();
  const listStations = jest.fn();
  const listIncidents = jest.fn();
  const markIncidentRead = jest.fn();
  const controller = new StationsController({
    acknowledgeLead,
    listStations,
    listIncidents,
    markIncidentRead,
  } as unknown as StationsService);
  const request = (user: Data | undefined) =>
    ({ user, body: { stationId: 'station-b' } }) as unknown as Request;

  beforeEach(() => {
    acknowledgeLead.mockReset();
    listStations.mockReset();
    listIncidents.mockReset();
    markIncidentRead.mockReset();
  });

  it('lists all stations', async () => {
    listStations.mockResolvedValue([stationA, stationB]);
    const result = await controller.listStations(
      request({ uid: 'operator-1', role: 'operator', stationId: 'station-a' }),
    );
    expect(result).toEqual([stationA, stationB]);
    expect(listStations).toHaveBeenCalledTimes(1);
  });

  it('lists incidents filtered by stationId from query param', async () => {
    listIncidents.mockResolvedValue([]);
    const req = request({ uid: 'operator-1', role: 'operator', stationId: 'station-a' });
    (req as unknown as { query: { stationId?: string } }).query = { stationId: 'station-a' };
    await controller.listIncidents(req as Request, 'station-a');
    expect(listIncidents).toHaveBeenCalledWith('station-a', 50, undefined);
  });

  it('lists incidents using operator stationId claim when no query param', async () => {
    listIncidents.mockResolvedValue([]);
    const req = request({ uid: 'operator-1', role: 'operator', stationId: 'station-a' });
    await controller.listIncidents(req as Request, undefined);
    expect(listIncidents).toHaveBeenCalledWith('station-a', 50, undefined);
  });

  it('passes pagination parameters to incident listing', async () => {
    listIncidents.mockResolvedValue({ data: [], nextCursor: null });
    const req = request({ uid: 'operator-1', role: 'operator', stationId: 'station-a' });
    await controller.listIncidents(req, undefined, '25', 'incident-2');
    expect(listIncidents).toHaveBeenCalledWith('station-a', 25, 'incident-2');
  });

  it('rejects operator querying a different station', async () => {
    const req = request({ uid: 'operator-1', role: 'operator', stationId: 'station-a' });
    (req as unknown as { query: { stationId?: string } }).query = { stationId: 'station-b' };
    await expect(controller.listIncidents(req as Request, 'station-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(listIncidents).not.toHaveBeenCalled();
  });

  it('rejects an operator without a station claim even when a query station is supplied', async () => {
    const req = request({ uid: 'operator-1', role: 'operator', stationId: undefined });
    await expect(controller.listIncidents(req as Request, 'station-a')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(listIncidents).not.toHaveBeenCalled();
  });

  it('marks an incident as read', async () => {
    markIncidentRead.mockResolvedValue({
      ...newIncident(),
      readAt: '2026-10-29T02:00:00.000Z',
      readByUid: 'operator-1',
      revision: 2,
    });
    const result = await controller.markIncidentRead(
      request({ uid: 'operator-1', role: 'operator', stationId: 'station-a' }),
      'incident-1',
    );
    expect(result.readAt).toBe('2026-10-29T02:00:00.000Z');
    expect(result.readByUid).toBe('operator-1');
    expect(markIncidentRead).toHaveBeenCalledWith('incident-1', 'station-a', 'operator-1');
  });

  it('rejects an operator without a station claim when marking an incident read', async () => {
    await expect(
      controller.markIncidentRead(request({ uid: 'operator-1', role: 'operator' }), 'incident-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(markIncidentRead).not.toHaveBeenCalled();
  });

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
