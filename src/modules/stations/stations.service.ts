import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { resolveStationRecipients } from './stations.routing';
import type {
  AuthorityIncident,
  AuthorityIncidentDocument,
  AuthorityIncidentPage,
  Station,
  StationLocation,
} from './stations.types';

type StoredAuthorityIncident = Partial<AuthorityIncidentDocument> & {
  readAt?: string | null;
  readByUid?: string | null;
};

export type ProjectIncidentInput = {
  sosId: string;
  location: StationLocation | null;
  coverageLabels: string[];
  stations: Station[];
  callbackNumber?: string | null;
  riderName?: string | null;
  vehicleSummary?: string | null;
  emergencyContactSummary?: string | null;
  reportSummary?: string | null;
  locationSummary?: string | null;
  receivedAt?: string;
};

@Injectable()
export class StationsService {
  constructor(@Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore) {}

  private toIncident(
    id: string,
    data: StoredAuthorityIncident,
    stationId?: string,
  ): AuthorityIncident {
    const notifiedRecipients = data.notifiedRecipients ?? [];
    const receipt = stationId ? data.readReceipts?.[stationId] : undefined;
    const {
      readReceipts: _readReceipts,
      readAt: _legacyReadAt,
      readByUid: _legacyReadByUid,
      ...incident
    } = data;
    return {
      ...incident,
      id,
      notifiedRecipients,
      notifiedStationIds:
        data.notifiedStationIds ?? notifiedRecipients.map((recipient) => recipient.stationId),
      readAt: receipt?.readAt ?? null,
      readByUid: receipt?.readByUid ?? null,
    } as AuthorityIncident;
  }

  private isNotifiedStation(incident: AuthorityIncident, stationId: string): boolean {
    return incident.notifiedRecipients.some((recipient) => recipient.stationId === stationId);
  }

  resolveRecipients({
    stations,
    location,
    coverageLabels,
    notifiedAt,
  }: {
    stations: Station[];
    location: StationLocation;
    coverageLabels: string[];
    notifiedAt?: string;
  }) {
    return resolveStationRecipients({ stations, location, coverageLabels, notifiedAt });
  }

  projectIncident(input: ProjectIncidentInput): AuthorityIncidentDocument {
    const receivedAt = input.receivedAt ?? new Date().toISOString();

    if (!input.location) {
      throw new BadRequestException('An SOS location is required before routing.');
    }

    const recipients = this.resolveRecipients({
      stations: input.stations,
      location: input.location,
      coverageLabels: input.coverageLabels,
      notifiedAt: receivedAt,
    });

    const incidentId = `incident-${input.sosId}`;
    const nextIncident: AuthorityIncidentDocument = {
      id: incidentId,
      sosId: input.sosId,
      revision: 1,
      receivedAt,
      status: 'new',
      location: input.location,
      locationSummary: input.locationSummary ?? null,
      coverage: {
        barangay: recipients.find((r) => r.reasons.includes('barangay'))?.stationName ?? null,
        police: recipients.find((r) => r.reasons.includes('police'))?.stationName ?? null,
      },
      notifiedRecipients: recipients,
      notifiedStationIds: recipients.map((recipient) => recipient.stationId),
      leadStationId: null,
      acknowledgedAt: null,
      acknowledgedByUid: null,
      readReceipts: {},
      callbackNumber: input.callbackNumber ?? null,
      riderName: input.riderName ?? null,
      vehicleSummary: input.vehicleSummary ?? null,
      emergencyContactSummary: input.emergencyContactSummary ?? null,
      reportSummary: input.reportSummary ?? null,
    };

    return nextIncident;
  }

  async listStations(): Promise<Station[]> {
    const snapshot = await this.firestore.collection('stations').get();
    return snapshot.docs.map((doc) => ({ ...(doc.data() as Omit<Station, 'id'>), id: doc.id }));
  }

  // Persists the routed incident for a new SOS. Pilot routing has no coverage
  // label source yet, so only the nearest available station is notified.
  // Idempotent: the incident id derives from the SOS id.
  async openIncidentForSos(input: {
    sosId: string;
    location: StationLocation;
    riderName: string | null;
    receivedAt: string;
  }): Promise<'created' | 'exists' | 'no_stations'> {
    const incident = this.projectIncident({
      sosId: input.sosId,
      location: input.location,
      coverageLabels: [],
      stations: await this.listStations(),
      riderName: input.riderName,
      receivedAt: input.receivedAt,
    });
    if (incident.notifiedRecipients.length === 0) return 'no_stations';
    try {
      await this.firestore.collection('authority_incidents').doc(incident.id).create(incident);
    } catch (error) {
      // ALREADY_EXISTS: a retry already opened it.
      if ((error as { code?: number }).code === 6) return 'exists';
      throw error;
    }
    return 'created';
  }

  async acknowledgeLead(input: {
    incidentId: string;
    stationId: string;
    actorUid: string;
  }): Promise<AuthorityIncident> {
    if (!input.incidentId.trim()) {
      throw new BadRequestException('An incident id is required.');
    }
    if (!input.stationId.trim()) {
      throw new UnauthorizedException('No station was selected for acknowledgment.');
    }

    const incidentRef = this.firestore.collection('authority_incidents').doc(input.incidentId);
    const stationRef = this.firestore.collection('stations').doc(input.stationId);

    const acknowledged = await this.firestore.runTransaction(async (transaction) => {
      const [incidentSnapshot, stationSnapshot] = await Promise.all([
        transaction.get(incidentRef),
        transaction.get(stationRef),
      ]);

      const incident = incidentSnapshot.data() as StoredAuthorityIncident | undefined;
      const station = stationSnapshot.data() as Partial<Station> | undefined;

      if (!incident) {
        throw new NotFoundException('Incident not found.');
      }

      const current = this.toIncident(incidentRef.id, incident, input.stationId);
      if (current.status === 'resolved') {
        throw new ConflictException('This incident is already resolved.');
      }
      if (current.leadStationId && current.leadStationId !== input.stationId) {
        throw new ConflictException(
          `This incident is already assigned to ${current.leadStationId}.`,
        );
      }
      if (current.leadStationId === input.stationId) {
        return { ...current, id: incidentRef.id };
      }
      if (!station) {
        throw new NotFoundException('Station not found.');
      }
      if (station.status !== 'active') {
        throw new ForbiddenException('The selected station is inactive.');
      }
      if (station.availability === 'offline' || station.availability === 'busy') {
        throw new ForbiddenException('The selected station is not available to acknowledge.');
      }

      const notifiedIds = current.notifiedRecipients?.map((recipient) => recipient.stationId) ?? [];
      if (!notifiedIds.includes(input.stationId)) {
        throw new ForbiddenException('This station is not a notified recipient for the incident.');
      }

      const next: AuthorityIncident = {
        ...current,
        id: incidentRef.id,
        revision: (current.revision ?? 0) + 1,
        status: 'acknowledged',
        leadStationId: input.stationId,
        acknowledgedAt: new Date().toISOString(),
        acknowledgedByUid: input.actorUid,
      };

      transaction.set(
        incidentRef,
        {
          revision: next.revision,
          status: next.status,
          leadStationId: next.leadStationId,
          acknowledgedAt: next.acknowledgedAt,
          acknowledgedByUid: next.acknowledgedByUid,
        },
        { merge: true },
      );
      return next;
    });

    return acknowledged;
  }

  async listIncidents(
    stationId: string,
    limit: number,
    cursor?: string,
  ): Promise<AuthorityIncidentPage> {
    const incidents = this.firestore.collection('authority_incidents');
    const query = incidents
      .where('notifiedStationIds', 'array-contains', stationId)
      .orderBy('receivedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    let pageQuery = query;
    if (cursor) {
      const cursorDocument = await incidents.doc(cursor).get();
      const cursorData = cursorDocument.data() as StoredAuthorityIncident | undefined;
      const cursorIncident = cursorData
        ? this.toIncident(cursorDocument.id, cursorData, stationId)
        : undefined;
      if (
        !cursorDocument.exists ||
        !cursorIncident ||
        !this.isNotifiedStation(cursorIncident, stationId)
      ) {
        throw new BadRequestException('The incident cursor is invalid.');
      }
      pageQuery = query.startAfter(cursorDocument);
    }

    const matching: Array<{ id: string; incident: AuthorityIncident }> = [];
    while (matching.length <= limit) {
      const remaining = limit + 1 - matching.length;
      const snapshot = await pageQuery.limit(remaining).get();
      if (snapshot.empty) break;

      for (const document of snapshot.docs) {
        const incident = this.toIncident(
          document.id,
          document.data() as StoredAuthorityIncident,
          stationId,
        );
        if (this.isNotifiedStation(incident, stationId)) {
          matching.push({ id: document.id, incident });
          if (matching.length > limit) break;
        }
      }

      if (matching.length > limit || snapshot.docs.length < remaining) break;
      pageQuery = query.startAfter(snapshot.docs.at(-1)!);
    }

    const hasMore = matching.length > limit;
    const page = matching.slice(0, limit);
    return {
      data: page.map(({ incident }) => incident),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async markIncidentRead(
    incidentId: string,
    stationId: string,
    actorUid: string,
  ): Promise<AuthorityIncident> {
    const incidentRef = this.firestore.collection('authority_incidents').doc(incidentId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(incidentRef);
      const data = snapshot.data() as StoredAuthorityIncident | undefined;
      if (!snapshot.exists || !data) {
        throw new NotFoundException('Incident not found.');
      }

      const incident = this.toIncident(incidentRef.id, data, stationId);
      if (!this.isNotifiedStation(incident, stationId)) {
        throw new ForbiddenException('This station is not a notified recipient for the incident.');
      }

      const readReceipt = {
        readAt: new Date().toISOString(),
        readByUid: actorUid,
      };
      const next: AuthorityIncident = {
        ...incident,
        ...readReceipt,
        revision: (incident.revision ?? 0) + 1,
      };
      transaction.set(
        incidentRef,
        {
          readReceipts: {
            ...(data.readReceipts ?? {}),
            [stationId]: readReceipt,
          },
          revision: next.revision,
        },
        { merge: true },
      );
      return next;
    });
  }
}
