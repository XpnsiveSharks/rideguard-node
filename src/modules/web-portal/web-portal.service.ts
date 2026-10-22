import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'crypto';
import { FIREBASE_AUTH, FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import type {
  SubmitApplicationDto,
  ReviewApplicationDto,
  TransitionIncidentDto,
} from './web-portal.dto';
import type { WebMembership } from './web-portal.types';

const transitions: Record<string, string[]> = {
  new: ['acknowledged', 'cancelled'],
  acknowledged: ['in_progress', 'cancelled'],
  in_progress: ['resolved', 'cancelled'],
  resolved: ['closed'],
  closed: [],
  cancelled: [],
};

const demoRoute = [
  [14.661, 120.984],
  [14.6615, 120.9844],
  [14.6621, 120.985],
  [14.6627, 120.9855],
  [14.6632, 120.986],
] as const;

type WebIncident = {
  id: string;
  organizationId: string;
  status: string;
  type: string;
  createdAt: string;
  timeline: Array<{ id: string; actorId?: string; label: string; createdAt: string }>;
  notes: Array<{ id: string; authorId: string; text: string; createdAt: string }>;
  resolution?: string;
  [key: string]: unknown;
};

@Injectable()
export class WebPortalService {
  constructor(
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
    @Inject(FIREBASE_AUTH) private readonly auth: Auth,
  ) {}

  private requireIdentity(user?: DecodedIdToken): DecodedIdToken {
    if (!user?.uid) throw new UnauthorizedException('Sign in required.');
    if (!user.email_verified) throw new ForbiddenException('Verify your email before web access.');
    return user;
  }

  private isAdmin(user: DecodedIdToken): boolean {
    return user.role === 'admin' || user.role === 'system_admin';
  }

  private requireAdmin(user?: DecodedIdToken): DecodedIdToken {
    const actor = this.requireIdentity(user);
    if (!this.isAdmin(actor)) throw new ForbiddenException('Administrator access required.');
    return actor;
  }

  private async membership(user?: DecodedIdToken): Promise<WebMembership> {
    const actor = this.requireIdentity(user);
    if (actor.role !== 'organization_manager' && actor.role !== 'organization_responder')
      throw new ForbiddenException('Organization access required.');
    const snapshot = await this.firestore.collection('web_memberships').doc(actor.uid).get();
    if (!snapshot.exists) throw new ForbiddenException('Organization membership unavailable.');
    const membership = snapshot.data() as WebMembership;
    if (membership.status !== 'active' || membership.role !== actor.role)
      throw new ForbiddenException('Organization membership inactive.');
    const organization = await this.firestore
      .collection('web_organizations')
      .doc(membership.organizationId)
      .get();
    if (!organization.exists || organization.data()?.status !== 'active')
      throw new ForbiddenException('Organization access inactive.');
    return membership;
  }

  async session(user?: DecodedIdToken) {
    const actor = this.requireIdentity(user);
    if (this.isAdmin(actor))
      return {
        user: {
          id: actor.uid,
          displayName:
            (typeof actor.name === 'string' ? actor.name : null) || actor.email || 'Administrator',
          role: 'system_admin',
          status: 'active',
        },
      };
    const membership = await this.membership(actor);
    const organization = await this.firestore
      .collection('web_organizations')
      .doc(membership.organizationId)
      .get();
    return {
      user: {
        id: actor.uid,
        displayName:
          (typeof actor.name === 'string' ? actor.name : null) ||
          actor.email ||
          'Organization user',
        role: membership.role,
        status: 'active',
        organizationId: membership.organizationId,
        organizationName:
          (organization.data() as { name?: string } | undefined)?.name || 'Organization',
      },
    };
  }

  async submitApplication(input: SubmitApplicationDto) {
    const officialEmail = input.officialEmail.trim().toLowerCase();
    const id = createHash('sha256').update(officialEmail).digest('hex').slice(0, 32);
    const reference = `RG-ORG-${id.slice(0, 8).toUpperCase()}`;
    const ref = this.firestore.collection('web_applications').doc(id);
    await this.firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists)
        throw new ConflictException('An application already exists for this official email.');
      transaction.create(ref, {
        ...input,
        officialEmail,
        representativeEmail: input.representativeEmail.trim().toLowerCase(),
        id,
        reference,
        status: 'pending',
        submittedAt: new Date().toISOString(),
        activationStatus: 'not_started',
      });
    });
    return { id, reference, status: 'pending' };
  }

  async applications(user?: DecodedIdToken) {
    this.requireAdmin(user);
    const snapshot = await this.firestore.collection('web_applications').limit(100).get();
    return snapshot.docs.map((doc) => doc.data());
  }

  async reviewApplication(
    user: DecodedIdToken | undefined,
    id: string,
    input: ReviewApplicationDto,
  ) {
    const actor = this.requireAdmin(user);
    if (input.status !== 'approved' && !input.reason?.trim())
      throw new BadRequestException('A reason is required for this decision.');
    const ref = this.firestore.collection('web_applications').doc(id);
    const orgRef = this.firestore.collection('web_organizations').doc(id);
    const auditRef = this.firestore.collection('web_audit').doc(randomUUID());
    const decisionAt = new Date().toISOString();
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new NotFoundException('Application unavailable.');
      const application = snapshot.data() as Record<string, unknown>;
      if (application.status !== 'pending' && application.status !== 'needs_info')
        throw new ConflictException('Application was already decided.');
      transaction.update(ref, {
        status: input.status,
        reason: input.reason?.trim() || null,
        reviewedBy: actor.uid,
        decisionAt,
        activationStatus: input.status === 'approved' ? 'awaiting_account_setup' : 'not_started',
      });
      if (input.status === 'approved')
        transaction.create(orgRef, {
          id,
          name: application.name,
          type: application.type,
          region: application.region,
          province: application.province || null,
          city: application.city,
          barangay: application.barangay,
          address: application.address,
          phone: application.phone,
          officialEmail: application.officialEmail,
          status: 'active',
          verifiedAt: decisionAt,
          verifiedBy: actor.uid,
        });
      transaction.create(auditRef, {
        actorId: actor.uid,
        action: `web.application.${input.status}`,
        targetId: id,
        createdAt: decisionAt,
      });
    });
    return {
      id,
      status: input.status,
      decisionAt,
      activationStatus: input.status === 'approved' ? 'awaiting_account_setup' : 'not_started',
    };
  }

  async organization(user?: DecodedIdToken) {
    const membership = await this.membership(user);
    const snapshot = await this.firestore
      .collection('web_organizations')
      .doc(membership.organizationId)
      .get();
    return snapshot.data();
  }

  async organizations(user?: DecodedIdToken) {
    this.requireAdmin(user);
    const snapshot = await this.firestore.collection('web_organizations').limit(100).get();
    return snapshot.docs.map((doc) => doc.data());
  }

  async changeOrganizationStatus(
    user: DecodedIdToken | undefined,
    id: string,
    status: 'active' | 'suspended',
  ) {
    const actor = this.requireAdmin(user);
    const ref = this.firestore.collection('web_organizations').doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new NotFoundException('Organization unavailable.');
    if (snapshot.data()?.status === status) return { id, status };
    const batch = this.firestore.batch();
    batch.update(ref, { status });
    batch.create(this.firestore.collection('web_audit').doc(randomUUID()), {
      actorId: actor.uid,
      action: `web.organization.${status}`,
      targetId: id,
      createdAt: new Date().toISOString(),
    });
    await batch.commit();
    return { id, status };
  }

  async staff(user?: DecodedIdToken) {
    const member = await this.membership(user);
    const snapshot = await this.firestore
      .collection('web_memberships')
      .where('organizationId', '==', member.organizationId)
      .limit(100)
      .get();
    return Promise.all(
      snapshot.docs.map(async (doc) => {
        const record = doc.data() as WebMembership;
        const account = await this.auth.getUser(record.uid);
        return {
          uid: record.uid,
          name: account.displayName || account.email || 'Staff member',
          email: account.email || '',
          role: record.role,
          status: record.status,
        };
      }),
    );
  }

  private async managerAndTarget(user: DecodedIdToken | undefined, targetUid: string) {
    const actor = this.requireIdentity(user);
    const member = await this.membership(actor);
    if (member.role !== 'organization_manager')
      throw new ForbiddenException('Organization manager access required.');
    if (actor.uid === targetUid)
      throw new ForbiddenException('You cannot change your own membership.');
    const ref = this.firestore.collection('web_memberships').doc(targetUid);
    const snapshot = await ref.get();
    const target = snapshot.data() as WebMembership | undefined;
    if (!snapshot.exists || target?.organizationId !== member.organizationId)
      throw new NotFoundException('Staff member unavailable.');
    return { actor, member, target, ref };
  }

  async changeStaffRole(
    user: DecodedIdToken | undefined,
    targetUid: string,
    role: WebMembership['role'],
  ) {
    const { actor, target, ref } = await this.managerAndTarget(user, targetUid);
    if (target.role === role) return { uid: targetUid, role, status: target.status };
    const account = await this.auth.getUser(targetUid);
    const originalClaims = account.customClaims || {};
    await this.auth.setCustomUserClaims(targetUid, { ...originalClaims, role });
    try {
      const batch = this.firestore.batch();
      batch.update(ref, { role });
      batch.create(this.firestore.collection('web_audit').doc(randomUUID()), {
        actorId: actor.uid,
        action: 'web.staff.role_changed',
        targetId: targetUid,
        organizationId: target.organizationId,
        createdAt: new Date().toISOString(),
      });
      await batch.commit();
    } catch (error) {
      await this.auth.setCustomUserClaims(targetUid, originalClaims);
      throw error;
    }
    return { uid: targetUid, role, status: target.status, reauthenticationRequired: true };
  }

  async changeStaffStatus(
    user: DecodedIdToken | undefined,
    targetUid: string,
    status: WebMembership['status'],
  ) {
    const { actor, target, ref } = await this.managerAndTarget(user, targetUid);
    if (target.status === status) return { uid: targetUid, role: target.role, status };
    const batch = this.firestore.batch();
    batch.update(ref, { status });
    batch.create(this.firestore.collection('web_audit').doc(randomUUID()), {
      actorId: actor.uid,
      action: `web.staff.${status}`,
      targetId: targetUid,
      organizationId: target.organizationId,
      createdAt: new Date().toISOString(),
    });
    await batch.commit();
    return { uid: targetUid, role: target.role, status };
  }

  async incidents(user?: DecodedIdToken) {
    const actor = this.requireIdentity(user);
    const collection = this.firestore.collection('web_incidents');
    const snapshot = this.isAdmin(actor)
      ? await collection.limit(100).get()
      : await collection
          .where('organizationId', '==', (await this.membership(actor)).organizationId)
          .limit(100)
          .get();
    return snapshot.docs.map((doc) => doc.data());
  }

  private async authorizedIncident(
    user: DecodedIdToken | undefined,
    id: string,
  ): Promise<WebIncident> {
    const actor = this.requireIdentity(user);
    const snapshot = await this.firestore.collection('web_incidents').doc(id).get();
    if (!snapshot.exists) throw new NotFoundException('Incident unavailable.');
    const incident = snapshot.data() as WebIncident;
    if (
      !this.isAdmin(actor) &&
      incident.organizationId !== (await this.membership(actor)).organizationId
    )
      throw new NotFoundException('Incident unavailable.');
    return incident;
  }

  async incident(user: DecodedIdToken | undefined, id: string) {
    return this.authorizedIncident(user, id);
  }

  async transitionIncident(
    user: DecodedIdToken | undefined,
    id: string,
    input: TransitionIncidentDto,
  ) {
    const actor = this.requireIdentity(user);
    await this.authorizedIncident(actor, id);
    const allowedOrganizationId = this.isAdmin(actor)
      ? null
      : (await this.membership(actor)).organizationId;
    const ref = this.firestore.collection('web_incidents').doc(id);
    const auditRef = this.firestore.collection('web_audit').doc(randomUUID());
    const createdAt = new Date().toISOString();
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new NotFoundException('Incident unavailable.');
      const current = snapshot.data() as WebIncident;
      if (allowedOrganizationId && current.organizationId !== allowedOrganizationId)
        throw new NotFoundException('Incident unavailable.');
      if (!transitions[current.status]?.includes(input.status))
        throw new ConflictException('This incident status transition is not allowed.');
      if (input.status === 'resolved' && !input.resolution?.trim())
        throw new BadRequestException('Resolution details are required.');
      transaction.update(ref, {
        status: input.status,
        resolution: input.resolution?.trim() || current.resolution || null,
        responderId: current.responderId || actor.uid,
        timeline: [
          ...(current.timeline || []),
          {
            id: randomUUID(),
            actorId: actor.uid,
            label: `Status changed to ${input.status.replace('_', ' ')}`,
            createdAt,
          },
        ],
        updatedAt: createdAt,
      });
      transaction.create(auditRef, {
        actorId: actor.uid,
        action: `web.incident.${input.status}`,
        targetId: id,
        createdAt,
      });
    });
    return this.authorizedIncident(actor, id);
  }

  async addNote(user: DecodedIdToken | undefined, id: string, text: string) {
    const actor = this.requireIdentity(user);
    await this.authorizedIncident(actor, id);
    const allowedOrganizationId = this.isAdmin(actor)
      ? null
      : (await this.membership(actor)).organizationId;
    const ref = this.firestore.collection('web_incidents').doc(id);
    const createdAt = new Date().toISOString();
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new NotFoundException('Incident unavailable.');
      const current = snapshot.data() as WebIncident;
      if (allowedOrganizationId && current.organizationId !== allowedOrganizationId)
        throw new NotFoundException('Incident unavailable.');
      transaction.update(ref, {
        notes: [
          ...(current.notes || []),
          { id: randomUUID(), authorId: actor.uid, text: text.trim(), createdAt },
        ],
      });
    });
    return this.authorizedIncident(actor, id);
  }

  async locations(user?: DecodedIdToken) {
    const membership = await this.membership(user);
    const snapshot = await this.firestore
      .collection('web_locations')
      .where('organizationId', '==', membership.organizationId)
      .limit(100)
      .get();
    const candidates = snapshot.docs
      .map((doc) => doc.data() as { status?: string; incidentId?: string; demo?: boolean })
      .filter(
        (location) =>
          (location.status === 'active' || location.demo === true) &&
          typeof location.incidentId === 'string',
      );
    const authorized = await Promise.all(
      candidates.map(async (location) => {
        try {
          await this.authorizedIncident(user, location.incidentId!);
          return location;
        } catch (error) {
          if (error instanceof NotFoundException) return null;
          throw error;
        }
      }),
    );
    return authorized.filter((location) => location !== null);
  }

  async demoLocation(user: DecodedIdToken | undefined, action: string) {
    const isolated =
      ['local', 'development'].includes(process.env.NODE_ENV || '') &&
      process.env.RIDEGUARD_WEB_DEMO_SEED === 'true' &&
      (Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST) ||
        Boolean(process.env.FIREBASE_PROJECT_ID?.toLowerCase().includes('demo')));
    if (!isolated) throw new ForbiddenException('Location simulation is disabled.');
    if (!['start', 'tick', 'pause', 'stop'].includes(action))
      throw new BadRequestException('Unknown simulation action.');
    const member = await this.membership(user);
    if (member.organizationId !== 'demo-barangay-34')
      throw new ForbiddenException('Location simulation is restricted to demo accounts.');
    await this.authorizedIncident(user, 'RG-DEMO-003');
    const ref = this.firestore.collection('web_locations').doc('RG-DEMO-LOCATION-003');
    const snapshot = await ref.get();
    const current = snapshot.data();
    if (!snapshot.exists || current?.demo !== true || current.incidentId !== 'RG-DEMO-003')
      throw new NotFoundException('Demo location unavailable.');
    if (action === 'tick' && current.simulationState !== 'running')
      throw new ConflictException('Start the simulation before advancing it.');
    const previousSequence = typeof current.sequence === 'number' ? current.sequence : 0;
    const nextSequence: number =
      action === 'start' ? 0 : action === 'tick' ? previousSequence + 1 : previousSequence;
    const point = demoRoute[nextSequence % demoRoute.length];
    const moving = action === 'start' || action === 'tick';
    const now = new Date().toISOString();
    await ref.update({
      simulationState: moving ? 'running' : action === 'pause' ? 'paused' : 'stopped',
      status: moving ? 'active' : 'ended',
      sequence: nextSequence,
      latitude: point[0],
      longitude: point[1],
      ...(moving ? { capturedAt: now, receivedAt: now } : {}),
    });
    return (await ref.get()).data();
  }

  async audit(user?: DecodedIdToken) {
    this.requireAdmin(user);
    const snapshot = await this.firestore.collection('web_audit').limit(100).get();
    return snapshot.docs.map((doc) => doc.data());
  }
}
