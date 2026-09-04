import { Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { PersonalInfo } from './domain/personal-info.value-object';
import { Profile } from './domain/profile.entity';
import { ProfileRepository } from './infrastructure/profile.repository';
import { Vehicle } from './domain/vehicle.value-object';
import { EmergencyContact, EmergencyContactFields } from './domain/emergency-contact.value-object';
import { CreateProfileInput } from './profile.types';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  // Creates a new profile for the user
  async createProfile(input: CreateProfileInput): Promise<void> {
    const personalInfo = PersonalInfo.create(input.personalInfoFields);

    const vehicle = Vehicle.create(input.vehicleInfoFields);

    const emergencyContact = EmergencyContact.create(input.emergencyContactFields);

    const profile = Profile.create({
      uid: input.uid,
      personalInfo: personalInfo,
      vehicle: vehicle,
      emergencyContact: emergencyContact,
    });

    await this.profileRepository.saveProfile(profile);
  }

  // creates a new emergency contact
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

  // Checks if a profile exists for the given UID
  async findProfileByUid(uid: string): Promise<boolean> {
    const IsEmptyProfileUid = Profile.isEmpty(uid);
    if (IsEmptyProfileUid) {
      throw new UnauthorizedException("We couldn't verify your account");
    }

    return await this.profileRepository.findProfileByUid(uid);
  }
}
