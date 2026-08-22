export class EmergencyContact {
  private constructor(
    public readonly contactName: string,
    public readonly phoneNumber: string,
    public readonly relationship: Relationship,
  ) {}

  static create(contactName: string, phoneNumber: string, relationship: string): EmergencyContact {
    return new EmergencyContact(
      contactName.trim(),
      phoneNumber.trim(),
      EmergencyContact.parseRelationship(relationship),
    );
  }

  changeContactName(newContactName: string): EmergencyContact {
    return new EmergencyContact(newContactName.trim(), this.phoneNumber, this.relationship);
  }

  changePhoneNumber(newPhoneNumber: string): EmergencyContact {
    return new EmergencyContact(this.contactName, newPhoneNumber.trim(), this.relationship);
  }

  changeRelationship(newRelationship: string): EmergencyContact {
    return new EmergencyContact(
      this.contactName,
      this.phoneNumber,
      EmergencyContact.parseRelationship(newRelationship),
    );
  }

  private static parseRelationship(value: string): Relationship {
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
