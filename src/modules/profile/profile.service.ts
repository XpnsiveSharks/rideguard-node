import { Injectable } from '@nestjs/common';
import { CreateProfileInput, EmergencyContactInput } from './profile.types';
import { PersonalInfo } from './domain/personal-info.value-object';
import { Profile } from './domain/profile.entity';
import { ProfileRepository } from './repositories/profile.repository';
import { Vehicle } from './domain/vehicle.value-object';
import { EmergencyContact } from './domain/emergency-contact.value-object';
@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  // Creates a new profile for the user
  async createProfile(
    input: CreateProfileInput,
    emergencyContactInput: EmergencyContactInput,
  ): Promise<void> {
    const personalInfo = PersonalInfo.create(input);

    const vehicle = Vehicle.create(input.vehicle);

    const emergencyContact = EmergencyContact.create(emergencyContactInput);

    const profile = Profile.create(input.uid!, personalInfo, vehicle, emergencyContact);

    await this.profileRepository.saveProfile(profile);
  }
<<<<<<< Updated upstream
=======

  // creates a new emergency contact
  async createEmergencyContact(
    uid: string | undefined,
    emergencyContactInput: EmergencyContactInput,
  ): Promise<void> {
    const profileUid = Profile.isEmpty(uid);

    const emergencyContact = EmergencyContact.create(emergencyContactInput);

    await this.profileRepository.saveContactInfo(profileUid, emergencyContact);
  }

  // Checks if a profile exists for the given UID
  async findProfileByUid(uid: string): Promise<boolean> {
    const profileUid = Profile.isEmpty(uid);

    return await this.profileRepository.findProfileByUid(profileUid);
  }
>>>>>>> Stashed changes
}
