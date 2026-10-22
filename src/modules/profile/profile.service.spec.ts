import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './infrastructure/profile.repository';
import { ContactRepository } from './infrastructure/contact.repository';
import { PhotoStorage } from './infrastructure/photo.storage';

describe('ProfileService', () => {
  let service: ProfileService;
  let mockProfileRepo: jest.Mocked<ProfileRepository>;
  let mockContactRepo: jest.Mocked<ContactRepository>;
  let mockPhotoStorage: jest.Mocked<PhotoStorage>;

  beforeEach(() => {
    mockProfileRepo = {
      getProfile: jest.fn(),
      saveProfile: jest.fn(),
      updateProfile: jest.fn(),
      saveContactInfo: jest.fn(),
      findProfileByUid: jest.fn(),
      updateEditableProfile: jest.fn(),
      updateProfilePhoto: jest.fn(),
    } as unknown as jest.Mocked<ProfileRepository>;

    mockContactRepo = {} as unknown as jest.Mocked<ContactRepository>;
    mockPhotoStorage = {} as unknown as jest.Mocked<PhotoStorage>;

    service = new ProfileService(mockProfileRepo, mockContactRepo, mockPhotoStorage);
  });

  describe('updateProfile', () => {
    it('throws UnauthorizedException if UID is empty or missing', async () => {
      await expect(service.updateProfile('', { first_name: 'John' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws BadRequestException if body has no editable fields', async () => {
      await expect(service.updateProfile('uid-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(mockProfileRepo.updateEditableProfile).not.toHaveBeenCalled();
    });

    it('updates editable fields without requiring a phone confirmation code', async () => {
      mockProfileRepo.updateEditableProfile.mockResolvedValue({
        uid: 'uid-1',
        personalInfo: { firstName: 'Jane', phoneNumber: '+15555550199' },
      });

      const result = await service.updateProfile('uid-1', {
        first_name: '  Jane  ',
        phone_number: '+15555550199',
        brand: 'Honda',
      });

      expect(mockProfileRepo.updateEditableProfile).toHaveBeenCalledWith('uid-1', {
        firstName: 'Jane',
        phoneNumber: '+15555550199',
        brand: 'Honda',
      });
      expect(result).toBeDefined();
    });

    it('propagates NotFoundException if repository throws it', async () => {
      mockProfileRepo.updateEditableProfile.mockRejectedValue(
        new NotFoundException('Profile does not exist'),
      );

      await expect(
        service.updateProfile('uid-1', { first_name: 'Jane' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
