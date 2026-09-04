import { Timestamps } from '@/common/types/domain-types';
import { EmergencyContact, EmergencyContactFields } from './emergency-contact.value-object';
import { PersonalInfoFields, PersonalInfo } from './personal-info.value-object';
import { Vehicle, VehicleInfoFields } from './vehicle.value-object';
import { UnauthorizedException } from '@nestjs/common';
export class Profile {
  private constructor(public readonly profileFields: ProfileFields) {}

  static create(profileFields: ProfileFields): Profile {
    const isEmptyUid = this.isEmpty(profileFields.uid);
    if (isEmptyUid) {
      throw new UnauthorizedException('Unable to verify your account. Please sign in again.');
    }

    const currentDateTime = new Date();

    return new Profile({
      uid: profileFields.uid,
      personalInfo: profileFields.personalInfo,
      vehicle: profileFields.vehicle,
      emergencyContact: profileFields.emergencyContact,
      createdAt: currentDateTime,
    });
  }

  static isEmpty(input: string | undefined): boolean {
    const isEmpty = !input || input.trim() === '';
    if (isEmpty) {
      throw new UnauthorizedException('Unable to verify your account. Please sign in again.');
    }
    return isEmpty;
  }

  private touch(): void {
    this.profileFields.updatedAt = new Date();
  }

  getUid(): string {
    const uid = this.profileFields.uid;
    if (!uid) {
      throw new UnauthorizedException('Unable to verify your account. Please sign in again.');
    }
    return uid;
  }

  getPersonalInfo(): PersonalInfoFields {
    return this.profileFields.personalInfo.personalInfoFields;
  }

  getVehicle(): VehicleInfoFields {
    return this.profileFields.vehicle.vehicleInfoFields;
  }

  getEmergencyContact(): EmergencyContactFields {
    return this.profileFields.emergencyContact.emergencyContactFields;
  }
}

export type ProfileFields = Timestamps & {
  uid?: string;
  personalInfo: PersonalInfo;
  vehicle: Vehicle;
  emergencyContact: EmergencyContact;
};
