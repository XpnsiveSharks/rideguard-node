import { AutoArchiveProcessorService } from './auto-archive-processor.service';
import type { SettingsService } from './settings.service';
import type { AlertsRepository } from '@/modules/alerts/infrastructure/alerts.repository';
import type { DevicesService } from '@/modules/devices/devices.service';

type ConfigArg = ConstructorParameters<typeof AutoArchiveProcessorService>[3];

function setup(opts: {
  enabled?: boolean;
  profiles?: Array<{ uid: string; autoArchiveHours: 24 | 48 | 72 }>;
  devicesByUid?: Record<string, string[]>;
  archived?: Record<string, number>;
} = {}) {
  const profiles = opts.profiles ?? [];
  const devicesByUid = opts.devicesByUid ?? {};
  const archived = opts.archived ?? {};

  const getEnabledProfiles = jest.fn().mockResolvedValue(profiles);
  const findDeviceIdsByAssignedUser = jest.fn(
    async (uid: string) => devicesByUid[uid] ?? [],
  );
  const archiveDueAlerts = jest.fn(
    async (params: { uid: string; limit: number }) => ({
      archived: archived[params.uid] ?? 0,
      scanned: 0,
    }),
  );

  const service = new AutoArchiveProcessorService(
    { getEnabledProfiles } as unknown as SettingsService,
    { archiveDueAlerts } as unknown as AlertsRepository,
    { findDeviceIdsByAssignedUser } as unknown as DevicesService,
    { get: jest.fn().mockReturnValue(opts.enabled ?? true) } as unknown as ConfigArg,
  );

  return { service, getEnabledProfiles, findDeviceIdsByAssignedUser, archiveDueAlerts };
}

describe('AutoArchiveProcessorService.run', () => {
  it('archives each enabled account with assigned devices, bounding work per pass', async () => {
    const { service, archiveDueAlerts } = setup({
      profiles: [
        { uid: 'user-1', autoArchiveHours: 24 },
        { uid: 'user-2', autoArchiveHours: 72 },
      ],
      devicesByUid: { 'user-1': ['CAM-1'], 'user-2': ['CAM-2', 'CAM-3'] },
      archived: { 'user-1': 3, 'user-2': 2 },
    });

    await service.run();

    expect(archiveDueAlerts).toHaveBeenCalledTimes(2);
    expect(archiveDueAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'user-1',
        deviceIds: ['CAM-1'],
        autoArchiveHours: 24,
        now: expect.any(Date),
        limit: expect.any(Number),
      }),
    );
    // Each call must carry a positive per-pass bound.
    for (const call of archiveDueAlerts.mock.calls) {
      expect(call[0].limit).toBeGreaterThan(0);
    }
  });

  it('skips accounts with no assigned devices', async () => {
    const { service, archiveDueAlerts } = setup({
      profiles: [{ uid: 'user-1', autoArchiveHours: 24 }],
      devicesByUid: { 'user-1': [] },
    });

    await service.run();
    expect(archiveDueAlerts).not.toHaveBeenCalled();
  });

  it('continues past an account whose archiving throws', async () => {
    const { service, archiveDueAlerts } = setup({
      profiles: [
        { uid: 'bad', autoArchiveHours: 24 },
        { uid: 'good', autoArchiveHours: 24 },
      ],
      devicesByUid: { bad: ['CAM-B'], good: ['CAM-G'] },
    });
    archiveDueAlerts.mockRejectedValueOnce(new Error('firestore down'));

    await expect(service.run()).resolves.toBeUndefined();
    expect(archiveDueAlerts).toHaveBeenCalledTimes(2);
  });

  it('does not run a second pass while one is already in progress', async () => {
    const { service, getEnabledProfiles } = setup({
      profiles: [{ uid: 'user-1', autoArchiveHours: 24 }],
      devicesByUid: { 'user-1': ['CAM-1'] },
    });

    let release!: () => void;
    getEnabledProfiles.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );

    const first = service.run();
    const second = service.run(); // should early-return via the in-flight guard
    await second;
    expect(getEnabledProfiles).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});
