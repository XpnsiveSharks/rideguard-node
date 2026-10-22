import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
    collection(name: string) {
      const collection = records[name];
      return {
        doc(id: string) {
          return {
            get: () =>
              Promise.resolve({ exists: Boolean(collection[id]), data: () => collection[id] }),
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
  return { records, service: new WebPortalService(firestore) };
}

describe('web portal server authorization', () => {
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
});
