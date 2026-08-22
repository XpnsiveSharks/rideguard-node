import { EmergencyContact } from './emergency-contact.value-object';
import { PersonalInfo } from './personal-info.value-object';
import { Vehicle } from './vehicle.value-object';

export class Profile {
  private constructor(
    private personalInfo: PersonalInfo,
    private vehicle?: Vehicle,
    private emergencyContact?: EmergencyContact,
    private updatedAt?: Date,
  ) {}

  static create(
    personalInfo: PersonalInfo,
    vehicle?: Vehicle,
    emergencyContact?: EmergencyContact,
  ): Profile {
    const now = new Date();

    return new Profile(personalInfo, vehicle, emergencyContact, now);
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

  getPersonalInfo(): PersonalInfo {
    return this.personalInfo;
  }

  getVehicle(): Vehicle | undefined {
    if (!this.vehicle) {
      return undefined;
    }
    return this.vehicle;
  }

  getEmergencyContact(): EmergencyContact | undefined {
    if (!this.emergencyContact) {
      return undefined;
    }
    return this.emergencyContact;
  }

  getUpdatedAt(): Date | undefined {
    return this.updatedAt;
  }

  private touch(): void {
    this.updatedAt = new Date();
  }
}
