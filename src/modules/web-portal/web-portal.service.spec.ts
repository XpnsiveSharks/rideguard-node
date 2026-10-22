import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WebPortalService } from './web-portal.service';

const responder = {
  uid: 'responder-a',
  email: 'responder@example.test',
  email_verified: true,
  role: 'organization_responder',
} as unknown as DecodedIdToken;
const admin = {
  uid: 'admin-a',
  email: 'admin@example.test',
  email_verified: true,
  role: 'admin',
} as unknown as DecodedIdToken;

function makeStore() {
  const records: Record<string, Record<string, Record<string, unknown>>> = {
    web_memberships: {
      'responder-a': {
        uid: 'responder-a',
        organizationId: 'org-a',
        role: 'organization_responder',
        status: 'active',
      },
    },
    web_organizations: { 'org-a': { id: 'org-a', name: 'Test unit', status: 'active' } },
    web_incidents: {
      'incident-b': {
        id: 'incident-b',
        organizationId: 'org-b',
        status: 'new',
        type: 'sos',
        createdAt: '',
        timeline: [],
        notes: [],
      },
    },
    web_applications: {},
    web_locations: {},
    web_audit: {},
  };
  const firestore = {
    runTransaction<T>(
      callback: (transaction: {
        get: (ref: {
          get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
        }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
        update: (
          ref: { update: (value: Record<string, unknown>) => Promise<void> },
          value: Record<string, unknown>,
        ) => void;
        create: (
          ref: { create: (value: Record<string, unknown>) => Promise<void> },
          value: Record<string, unknown>,
        ) => void;
      }) => Promise<T>,
    ) {
      return callback({
        get: (ref) => ref.get(),
        update: (ref, value) => {
          void ref.update(value);
        },
        create: (ref, value) => {
          void ref.create(value);
        },
      });
    },
    batch() {
      const operations: Array<() => void> = [];
      return {
        update(
          ref: { update: (value: Record<string, unknown>) => Promise<void> },
          value: Record<string, unknown>,
        ) {
          operations.push(() => {
            void ref.update(value);
          });
        },
        create(
          ref: { create: (value: Record<string, unknown>) => Promise<void> },
          value: Record<string, unknown>,
        ) {
          operations.push(() => {
            void ref.create(value);
          });
        },
        commit: () => {
          operations.forEach((operation) => operation());
          return Promise.resolve();
        },
      };
    },
    collection(name: string) {
      const collection = records[name];
      return {
        doc(id: string) {
          return {
            get: () =>
              Promise.resolve({ exists: Boolean(collection[id]), data: () => collection[id] }),
            update: (value: Record<string, unknown>) => {
              collection[id] = { ...collection[id], ...value };
              return Promise.resolve();
            },
            create: (value: Record<string, unknown>) => {
              collection[id] = value;
              return Promise.resolve();
            },
          };
        },
        limit() {
          return {
            get: () =>
              Promise.resolve({
                docs: Object.values(collection).map((value) => ({ data: () => value })),
              }),
          };
        },
        where(field: string, _operator: string, value: unknown) {
          return {
            limit: () => ({
              get: () =>
                Promise.resolve({
                  docs: Object.values(collection)
                    .filter((record) => record[field] === value)
                    .map((record) => ({ data: () => record })),
                }),
            }),
          };
        },
      };
    },
  } as unknown as Firestore;
  const claims: Record<string, Record<string, unknown>> = {
    'responder-a': { role: 'organization_responder' },
  };
  const auth = {
    getUser: (uid: string) =>
      Promise.resolve({
        uid,
        email: `${uid}@example.test`,
        displayName: uid,
        customClaims: claims[uid] || {},
      }),
    setCustomUserClaims: (uid: string, value: Record<string, unknown>) => {
      claims[uid] = value;
      return Promise.resolve();
    },
  } as unknown as Auth;
  return { records, claims, service: new WebPortalService(firestore, auth) };
}

describe('web portal server authorization', () => {
  it('persists an application, rejects duplicates, and records an administrator decision without granting access', async () => {
    const { records, service } = makeStore();
    const application = {
      name: 'Barangay 35',
      type: 'barangay' as const,
      region: 'Metro Manila',
      city: 'Caloocan City',
      barangay: 'Barangay 35',
      address: 'Fictional office address',
      phone: '09123456789',
      officialEmail: 'barangay35@demo.rideguard.local',
      representative: 'Ana Reyes',
      position: 'Representative',
      representativePhone: '09123456789',
      representativeEmail: 'ana@demo.rideguard.local',
      verificationInfo: 'Fictional thesis application for tests',
    };
    const submitted = await service.submitApplication(application);
    expect(submitted.status).toBe('pending');
    expect(submitted.reference).toMatch(/^RG-ORG-/);
    await expect(service.submitApplication(application)).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reviewApplication(responder, submitted.id, { status: 'approved' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.reviewApplication(admin, submitted.id, { status: 'approved' }),
    ).resolves.toMatchObject({ status: 'approved', activationStatus: 'awaiting_account_setup' });
    expect(records.web_organizations[submitted.id].status).toBe('active');
    expect(records.web_applications[submitted.id].reviewedBy).toBe('admin-a');
    const applicant = {
      uid: 'applicant-a',
      email: application.officialEmail,
      email_verified: true,
      role: 'organization_manager',
    } as unknown as DecodedIdToken;
    await expect(service.session(applicant)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('persists an assigned incident transition and note but rejects cross-organization updates', async () => {
    const { records, service } = makeStore();
    records.web_incidents['incident-a'] = {
      id: 'incident-a',
      organizationId: 'org-a',
      status: 'new',
      type: 'sos',
      createdAt: '',
      timeline: [],
      notes: [],
    };
    await expect(
      service.transitionIncident(responder, 'incident-b', { status: 'acknowledged' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.transitionIncident(responder, 'incident-a', { status: 'acknowledged' }),
    ).resolves.toMatchObject({ status: 'acknowledged' });
    await expect(
      service.addNote(responder, 'incident-a', 'Responder en route'),
    ).resolves.toMatchObject({ notes: [expect.objectContaining({ text: 'Responder en route' })] });
    expect((records.web_incidents['incident-a'].timeline as unknown[]).length).toBe(1);
    await expect(
      service.transitionIncident(responder, 'incident-a', { status: 'closed' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('requires an active, matching organization membership for a web session', async () => {
    const { records, service } = makeStore();
    await expect(service.session(responder)).resolves.toMatchObject({
      user: { role: 'organization_responder', organizationId: 'org-a' },
    });
    records.web_memberships['responder-a'].status = 'suspended';
    await expect(service.session(responder)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects organization staff from the administrator application queue', async () => {
    const { service } = makeStore();
    await expect(service.applications(responder)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.applications(admin)).resolves.toEqual([]);
  });

  it('lets an administrator suspend an organization and immediately denies its staff', async () => {
    const { records, service } = makeStore();
    await expect(service.organizations(responder)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.changeOrganizationStatus(admin, 'org-a', 'suspended')).resolves.toEqual({
      id: 'org-a',
      status: 'suspended',
    });
    expect(records.web_organizations['org-a'].status).toBe('suspended');
    await expect(service.session(responder)).rejects.toBeInstanceOf(ForbiddenException);
    expect(Object.values(records.web_audit)).toContainEqual(
      expect.objectContaining({ action: 'web.organization.suspended', actorId: 'admin-a' }),
    );
  });

  it('rejects unverified administrator tokens from web data', async () => {
    const { service } = makeStore();
    const unverified = { ...admin, email_verified: false } as DecodedIdToken;
    await expect(service.applications(unverified)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.incidents(unverified)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns no cross-organization incident details', async () => {
    const { service } = makeStore();
    await expect(service.incident(responder, 'incident-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.incident(admin, 'incident-b')).resolves.toMatchObject({
      id: 'incident-b',
    });
  });

  it('keeps the fictional location simulator scoped and marks stopped sharing as ended', async () => {
    const { records, service } = makeStore();
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      RIDEGUARD_WEB_DEMO_SEED: process.env.RIDEGUARD_WEB_DEMO_SEED,
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    };
    try {
      await expect(service.demoLocation(responder, 'start')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      process.env.NODE_ENV = 'development';
      process.env.RIDEGUARD_WEB_DEMO_SEED = 'true';
      process.env.FIREBASE_PROJECT_ID = 'rideguard-demo-test';
      records.web_organizations['demo-barangay-34'] = {
        id: 'demo-barangay-34',
        name: 'Demo unit',
        status: 'active',
      };
      records.web_incidents['RG-DEMO-003'] = {
        id: 'RG-DEMO-003',
        organizationId: 'demo-barangay-34',
        status: 'in_progress',
        type: 'sos',
        createdAt: '',
        timeline: [],
        notes: [],
      };
      records.web_locations['RG-DEMO-LOCATION-003'] = {
        id: 'RG-DEMO-LOCATION-003',
        incidentId: 'RG-DEMO-003',
        organizationId: 'demo-barangay-34',
        demo: true,
        latitude: 14.661,
        longitude: 120.984,
        status: 'ended',
        simulationState: 'stopped',
      };
      await expect(service.demoLocation(responder, 'start')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      records.web_memberships['responder-a'].organizationId = 'demo-barangay-34';
      await expect(service.demoLocation(responder, 'start')).resolves.toMatchObject({
        status: 'active',
        simulationState: 'running',
        sequence: 0,
      });
      await expect(service.demoLocation(responder, 'tick')).resolves.toMatchObject({
        status: 'active',
        sequence: 1,
        latitude: 14.6615,
      });
      await expect(service.demoLocation(responder, 'stop')).resolves.toMatchObject({
        status: 'ended',
        simulationState: 'stopped',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('lets a manager change a same-organization role and blocks responder self-management', async () => {
    const { records, claims, service } = makeStore();
    records.web_memberships['manager-a'] = {
      uid: 'manager-a',
      organizationId: 'org-a',
      role: 'organization_manager',
      status: 'active',
    };
    records.web_memberships['outsider-b'] = {
      uid: 'outsider-b',
      organizationId: 'org-b',
      role: 'organization_responder',
      status: 'active',
    };
    const manager = {
      uid: 'manager-a',
      email: 'manager@example.test',
      email_verified: true,
      role: 'organization_manager',
    } as unknown as DecodedIdToken;
    await expect(service.staff(responder)).resolves.toHaveLength(2);
    await expect(
      service.changeStaffStatus(manager, 'outsider-b', 'suspended'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.changeStaffRole(responder, 'manager-a', 'organization_responder'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.changeStaffRole(manager, 'manager-a', 'organization_responder'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.changeStaffRole(manager, 'responder-a', 'organization_manager'),
    ).resolves.toMatchObject({ uid: 'responder-a', role: 'organization_manager' });
    expect(records.web_memberships['responder-a'].role).toBe('organization_manager');
    expect(claims['responder-a'].role).toBe('organization_manager');
    expect(Object.values(records.web_audit)).toContainEqual(
      expect.objectContaining({ action: 'web.staff.role_changed', actorId: 'manager-a' }),
    );
  });
});
