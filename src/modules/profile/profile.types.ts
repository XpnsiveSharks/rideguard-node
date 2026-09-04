import { EmergencyContactFields } from './domain/emergency-contact.value-object';
import { PersonalInfoFields } from './domain/personal-info.value-object';
import { VehicleInfoFields } from './domain/vehicle.value-object';

export type CreateProfileInput = {
  uid?: string;
  personalInfoFields: PersonalInfoFields;
  vehicleInfoFields: VehicleInfoFields;
  emergencyContactFields: EmergencyContactFields;
};
