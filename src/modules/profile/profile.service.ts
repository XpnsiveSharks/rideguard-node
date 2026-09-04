import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PersonalInfo } from './domain/personal-info.value-object';
import { Profile, ProfileFields } from './domain/profile.entity';
import { ProfileRepository } from './repositories/profile.repository';
import { Vehicle } from './domain/vehicle.value-object';
import { EmergencyContact, EmergencyContactFields } from './domain/emergency-contact.value-object';
@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  // Creates a new profile for the user
  async createProfile(input: ProfileFields): Promise<void> {
    const personalInfo = PersonalInfo.create(input.personalInfo.personalInfoFields);

    const vehicle = Vehicle.create(input.vehicle.vehicleInfoFields);

    const emergencyContact = EmergencyContact.create(input.emergencyContact.emergencyContactFields);

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
    uid: string,
    emergencyContactInput: EmergencyContactFields,
  ): Promise<void> {
    const IsEmptyUid = Profile.isEmpty(uid);
    if (IsEmptyUid) {
      throw new UnauthorizedException("We couldn't verify your account");
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
