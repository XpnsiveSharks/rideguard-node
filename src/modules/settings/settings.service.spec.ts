import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { FIREBASE_FIRESTORE } from '@/infra/firebase/firebase.constants';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

describe('SettingsController & SettingsService', () => {
  let controller: SettingsController;
  let service: SettingsService;

  const mockProfileDoc = {
    data: jest.fn(),
  };

  const mockProfileRef = {
    get: jest.fn().mockResolvedValue(mockProfileDoc),
    set: jest.fn().mockResolvedValue(undefined),
  };

  const mockFirestore = {
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue(mockProfileRef),
      where: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: [
            { id: 'user-1', data: () => ({ autoArchiveHours: 24 }) },
            { id: 'user-2', data: () => ({ autoArchiveHours: 48 }) },
          ],
        }),
      }),
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        SettingsService,
        {
          provide: FIREBASE_FIRESTORE,
          useValue: mockFirestore,
        },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    service = module.get<SettingsService>(SettingsService);
  });

  describe('getAutoArchive', () => {
    it('returns null if autoArchiveHours is not set in firestore', async () => {
      mockProfileDoc.data.mockReturnValue({});
      const req = { user: { uid: 'test-user' } } as unknown as Request;

      const res = await controller.getAutoArchive(req);
      expect(res).toEqual({ autoArchiveHours: null });
    });

    it('returns saved autoArchiveHours and caches it', async () => {
      mockProfileDoc.data.mockReturnValue({ autoArchiveHours: 48 });
      const req = { user: { uid: 'test-user' } } as unknown as Request;

      const res = await controller.getAutoArchive(req);
      expect(res).toEqual({ autoArchiveHours: 48 });

      // Second call should hit in-memory cache without calling firestore get
      mockProfileDoc.data.mockClear();
      const cachedRes = await controller.getAutoArchive(req);
      expect(cachedRes).toEqual({ autoArchiveHours: 48 });
      expect(mockProfileRef.get).toHaveBeenCalledTimes(1);
    });

    it('throws UnauthorizedException if req.user is missing', async () => {
      const req = {} as unknown as Request;
      await expect(controller.getAutoArchive(req)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('updateAutoArchive', () => {
    it('saves valid autoArchiveHours and updates cache', async () => {
      const req = { user: { uid: 'test-user' } } as unknown as Request;

      const res = await controller.updateAutoArchive(req, { autoArchiveHours: 72 });
      expect(res).toEqual({ autoArchiveHours: 72 });
      expect(mockProfileRef.set).toHaveBeenCalledWith({ autoArchiveHours: 72 }, { merge: true });

      // Cache should be updated
      const getRes = await controller.getAutoArchive(req);
      expect(getRes).toEqual({ autoArchiveHours: 72 });
    });

    it('allows setting autoArchiveHours to null (Never)', async () => {
      const req = { user: { uid: 'test-user' } } as unknown as Request;

      const res = await controller.updateAutoArchive(req, { autoArchiveHours: null });
      expect(res).toEqual({ autoArchiveHours: null });
      expect(mockProfileRef.set).toHaveBeenCalledWith({ autoArchiveHours: null }, { merge: true });
    });

    it('throws UnauthorizedException if req.user is missing', async () => {
      const req = {} as unknown as Request;
      await expect(controller.updateAutoArchive(req, { autoArchiveHours: 24 })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getEnabledProfiles', () => {
    it('returns list of users with active autoArchive', async () => {
      const profiles = await service.getEnabledProfiles();
      expect(profiles).toEqual([
        { uid: 'user-1', autoArchiveHours: 24 },
        { uid: 'user-2', autoArchiveHours: 48 },
      ]);
    });
  });
});
