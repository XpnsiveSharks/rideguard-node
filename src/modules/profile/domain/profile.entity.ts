import { EmergencyContact } from './emergency-contact.value-object';
import { PersonalInfo } from './personal-info.value-object';
import { Vehicle } from './vehicle.value-object';

export class Profile {
  private constructor(
    public readonly id: string,
    private personalInfo: PersonalInfo,
    private vehicle: Vehicle,
    private emergencyContact: EmergencyContact,
    private profileImageUrl: string,
    public readonly createdAt: Date,
    private updatedAt: Date,
  ) {}

  static create(
    id: string,
    personalInfo: PersonalInfo,
    vehicle: Vehicle,
    emergencyContact: EmergencyContact,
    profileImageUrl: string,
  ): Profile {
    const now = new Date();

    return new Profile(
      id,
      personalInfo,
      vehicle,
      emergencyContact,
      profileImageUrl.trim(),
      now,
      now,
    );
  }

  updatePersonalInfo(personalInfo: PersonalInfo): void {
    this.personalInfo = personalInfo;
    this.touch();
  }

  updateVehicle(vehicle: Vehicle): void {
    this.vehicle = vehicle;
    this.touch();
  }

  updateEmergencyContact(emergencyContact: EmergencyContact): void {
    this.emergencyContact = emergencyContact;
    this.touch();
  }

  updateProfileImage(profileImageUrl: string): void {
    this.profileImageUrl = profileImageUrl.trim();
    this.touch();
  }

  getPersonalInfo(): PersonalInfo {
    return this.personalInfo;
  }

  getVehicle(): Vehicle {
    return this.vehicle;
  }

  getEmergencyContact(): EmergencyContact {
    return this.emergencyContact;
  }

  getProfileImageUrl(): string {
    return this.profileImageUrl;
  }

  getUpdatedAt(): Date {
    return this.updatedAt;
  }

  private touch(): void {
    this.updatedAt = new Date();
  }
}
