import { EmergencyContact } from '../../domain/emergency-contact.value-object';

export class EmergencyContactMapper {
  static toPersistence(emergencyContact: EmergencyContact) {
    return {
      emergencyContact: {
        emergencyContactName: emergencyContact.getContactName(),
        emergencyContactRelationship: emergencyContact.getRelationship(),
        phoneNumber: emergencyContact.getPhoneNumber(),
      },
    };
  }
}
