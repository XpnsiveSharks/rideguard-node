import { Profile } from '../domain/profile.entity';

export class ProfileMapper {
  static toPersistence(profile: Profile) {
    const personalInfo = profile.getPersonalInfo();
    const vehicle = profile.getVehicle();
    const emergencyContact = profile.getEmergencyContact();
    return {
      uid: profile.getUid(),
      personalInfo: {
        firstName: personalInfo.firstName,
        lastName: personalInfo.lastName,
        phoneNumber: personalInfo.phoneNumber,
        email: personalInfo.email,
        profileImageUrl: personalInfo.profileImageUrl,
      },
      vehicle: {
        model: vehicle.vehicleName,
        plateNumber: vehicle.plateNumber,
        color: vehicle.color,
      },
      emergencyContact: {
        emergencyContactName: emergencyContact.contactName,
        emergencyContactRelationship: emergencyContact.relationship,
        phoneNumber: emergencyContact.phoneNumber,
      },
    };
  }
}
