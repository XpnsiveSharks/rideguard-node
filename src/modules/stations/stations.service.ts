import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { resolveStationRecipients } from './stations.routing';
import type { AuthorityIncident, Station, StationLocation } from './stations.types';

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

  projectIncident(input: ProjectIncidentInput): AuthorityIncident {
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
    const nextIncident: AuthorityIncident = {
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
      leadStationId: null,
      acknowledgedAt: null,
      acknowledgedByUid: null,
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

      const incident = incidentSnapshot.data() as Partial<AuthorityIncident> | undefined;
      const station = stationSnapshot.data() as Partial<Station> | undefined;

      if (!incident) {
        throw new NotFoundException('Incident not found.');
      }

      const current = incident as AuthorityIncident;
      if (incident.status === 'resolved') {
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

      transaction.set(incidentRef, next, { merge: true });
      return next;
    });

    return acknowledged;
  }
}
