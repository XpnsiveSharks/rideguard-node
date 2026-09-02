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
    if (value === undefined) return undefined;

    const relationship = value.trim();

    if (!Object.values(Relationship).includes(relationship as Relationship)) {
      throw new Error(
        `Invalid relationship "${relationship}". Please select a valid relationship type.`,
      );
    }

    return relationship as Relationship;
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
