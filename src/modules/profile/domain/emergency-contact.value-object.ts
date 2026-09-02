import { parseOptionalEnumValue } from '@/common/helpers/enum-parser';

export class EmergencyContact {
  private constructor(public readonly emergencyContactInfo: EmergencyContactInfo) {}

  static create(emergencyContactInfo: EmergencyContactInfo): EmergencyContact {
    const { contactName, phoneNumber, relationship } = emergencyContactInfo;
    return !contactName
      ? new EmergencyContact({
          contactName: undefined,
          phoneNumber: phoneNumber,
          relationship: EmergencyContact.parseRelationship(relationship),
        })
      : !phoneNumber
        ? new EmergencyContact({
            contactName: contactName,
            phoneNumber: undefined,
            relationship: EmergencyContact.parseRelationship(relationship),
          })
        : !contactName && !phoneNumber && !relationship
          ? new EmergencyContact({
              contactName: undefined,
              phoneNumber: undefined,
              relationship: undefined,
            })
          : new EmergencyContact({
              contactName: contactName,
              phoneNumber: phoneNumber,
              relationship: EmergencyContact.parseRelationship(relationship),
            });
  }

  private static parseRelationship(value: string | undefined): Relationship | undefined {
    return parseOptionalEnumValue(value, Relationship, 'relationship');
  }
}

export enum Relationship {
  Parent = 'Parent',
  Child = 'Child',
  Sibling = 'Sibling',
  Spouse = 'Spouse',
  Partner = 'Partner',
  Friend = 'Friend',
  Colleague = 'Colleague',
  Mentor = 'Mentor',
  Student = 'Student',
  Other = 'Other',
}

type EmergencyContactInfo = {
  contactName?: string;
  phoneNumber?: string;
  relationship?: string;
};
