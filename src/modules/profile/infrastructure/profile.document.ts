import { EmergencyContact } from '../domain/emergency-contact.value-object';
import { PersonalInfo } from '../domain/personal-info.value-object';
import { Vehicle } from '../domain/vehicle.value-object';
import { Timestamp } from 'firebase-admin/firestore';

export const PROFILES_COLLECTION = 'profiles';

// NOT YET USE, REMOVE COMMENT WHEN USED
export type ProfileFields = {
  uid?: string;
  personalInfo: PersonalInfo;
  vehicle: Vehicle;
  emergencyContact: EmergencyContact;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};
