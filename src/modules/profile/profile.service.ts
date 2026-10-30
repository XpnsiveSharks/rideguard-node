import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PersonalInfo } from './domain/personal-info.value-object';
import { Profile } from './domain/profile.entity';
import { ProfileRepository } from './infrastructure/profile.repository';
import { Vehicle } from './domain/vehicle.value-object';
import { EmergencyContact, EmergencyContactFields } from './domain/emergency-contact.value-object';
import { CreateProfileInput } from './profile.types';
import { ContactRepository, EmergencyContactRecord } from './infrastructure/contact.repository';
import { PhotoStorage } from './infrastructure/photo.storage';
import { CONTACT_PHOTO_BUCKET_FOLDER, PROFILE_PHOTO_BUCKET_FOLDER } from './profile.constants';
import { EmergencyContactDto, UpdateEmergencyContactDto } from './contacts.dto';
import type { UploadedPhoto } from './profile.upload';
import type { UpdateProfileDto } from './profile-update.dto';

@Injectable()
export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly contactRepository: ContactRepository,
    private readonly photoStorage: PhotoStorage,
  ) {}

  // *** CREATES A NEW PROFILE ***
  async createProfile(input: CreateProfileInput): Promise<void> {
    const personalInfo = PersonalInfo.create(input.personalInfoFields);

    const vehicle = Vehicle.create(input.vehicleInfoFields);

    const emergencyContact = EmergencyContact.create(input.emergencyContactFields);

    const existing = await this.profileRepository.getProfile(input.uid as string);

    if (existing?.personalInfo) {
      throw new UnprocessableEntityException('User already exists');
    }

    const profile = Profile.create({
      uid: input.uid,
      personalInfo: personalInfo,
      vehicle: vehicle,
      emergencyContact: emergencyContact,
    });

    if (existing) {
      await this.profileRepository.updateProfile(profile);
    } else {
      await this.profileRepository.saveProfile(profile);
    }
  }

  // *** CREATES A NEW EMERGENCY CONTACT ***
  async createEmergencyContact(
    uid: string | undefined,
    emergencyContactInput: EmergencyContactFields,
  ): Promise<void> {
    if (!uid || uid.trim() === '') {
      throw new UnprocessableEntityException(
        'We could not verify your account. Please log in again.',
      );
    }

    const emergencyContact = EmergencyContact.create(emergencyContactInput);

    await this.profileRepository.saveContactInfo(uid, emergencyContact);
  }

  // *** CHECKS IF A PROFILE EXISTS FOR THE GIVEN UID ***
  async findProfileByUid(uid: string): Promise<boolean> {
    const IsEmptyProfileUid = Profile.isEmpty(uid);
    if (IsEmptyProfileUid) {
      throw new UnauthorizedException("We couldn't verify your account");
    }

    return await this.profileRepository.findProfileByUid(uid);
  }

  async getProfile(uid: string) {
    return this.profileRepository.getProfile(uid);
  }

  async updateProfile(uid: string, input: UpdateProfileDto) {
    if (!uid?.trim()) {
      throw new UnauthorizedException('Unable to verify your account. Please sign in again.');
    }
    const hasAtLeastOneField =
      input && Object.values(input).some((val) => val !== undefined);
    if (!hasAtLeastOneField) {
      throw new BadRequestException('At least one editable field must be provided');
    }
    // Email, uid, role, and verification state are deliberately absent from the DTO.
    // Phone confirmation is planned here, but is temporarily disabled until the
    // confirmation-code delivery service is available. Do not enable enforcement
    // without adding an account-bound, expiring code challenge.
    return this.profileRepository.updateEditableProfile(uid, {
      ...(input.first_name !== undefined && { firstName: input.first_name.trim() }),
      ...(input.last_name !== undefined && { lastName: input.last_name.trim() }),
      ...(input.phone_number !== undefined && { phoneNumber: input.phone_number.trim() }),
      ...(input.brand !== undefined && { brand: input.brand.trim() }),
      ...(input.model !== undefined && { model: input.model.trim() }),
      ...(input.plate_number !== undefined && { plateNumber: input.plate_number.trim() }),
      ...(input.color !== undefined && { color: input.color.trim() }),
    });
  }

  async uploadProfilePhoto(uid: string, file: UploadedPhoto) {
    if (!file) throw new BadRequestException('Photo file is required');
    const profile = await this.profileRepository.getProfile(uid);
    const uploaded = await this.photoStorage.upload(PROFILE_PHOTO_BUCKET_FOLDER, uid, file);
    await this.profileRepository.updateProfilePhoto(uid, uploaded);
    await this.photoStorage.deleteByPublicId(
      typeof profile?.public_id === 'string' ? profile.public_id : undefined,
    );
    return uploaded;
  }

  async listContacts(uid: string): Promise<EmergencyContactRecord[]> {
    return this.contactRepository.list(uid);
  }

  async getContact(uid: string, id: string): Promise<EmergencyContactRecord> {
    return this.contactRepository.findOwned(uid, id);
  }

  async createContact(uid: string, input: EmergencyContactDto, file?: UploadedPhoto) {
    const uploaded = file
      ? await this.photoStorage.upload(CONTACT_PHOTO_BUCKET_FOLDER, uid, file)
      : { photo_url: null, public_id: null };
    return this.contactRepository.create(uid, {
      name: input.name.trim(),
      phone: input.phone,
      email: input.email.trim().toLowerCase(),
      relationship: input.relationship,
      photo_url: uploaded.photo_url,
      public_id: uploaded.public_id,
    });
  }

  async updateContact(
    uid: string,
    id: string,
    input: UpdateEmergencyContactDto,
    file?: UploadedPhoto,
  ) {
    const current = await this.contactRepository.findOwned(uid, id);
    const uploaded = file
      ? await this.photoStorage.upload(CONTACT_PHOTO_BUCKET_FOLDER, uid, file)
      : { photo_url: current.photo_url, public_id: current.public_id };
    const updated = await this.contactRepository.update(uid, id, {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.email !== undefined && { email: input.email.trim().toLowerCase() }),
      ...(input.relationship !== undefined && { relationship: input.relationship }),
      photo_url: uploaded.photo_url,
      public_id: uploaded.public_id,
    });
    if (file) await this.photoStorage.deleteByPublicId(current.public_id);
    return updated;
  }

  async deleteContact(uid: string, id: string): Promise<void> {
    const deleted = await this.contactRepository.delete(uid, id);
    await this.photoStorage.deleteByPublicId(deleted.public_id);
  }
}
