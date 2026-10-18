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

    const alreadyExists = await this.profileRepository.findProfileByUid(input.uid as string);

    if (alreadyExists) {
      throw new UnprocessableEntityException('User already exists');
    }

    const profile = Profile.create({
      uid: input.uid,
      personalInfo: personalInfo,
      vehicle: vehicle,
      emergencyContact: emergencyContact,
    });

    await this.profileRepository.saveProfile(profile);
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
