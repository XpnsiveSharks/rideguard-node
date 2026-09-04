import { BadRequestException } from '@nestjs/common';

export class PersonalInfo {
  private constructor(public personalInfoFields: Info) {}

  static create(info: Info): PersonalInfo {
    const trimmedFirstName = info.firstName.trim();
    if (!trimmedFirstName) throw new BadRequestException('First name is required');

    const trimmedLastName = info.lastName.trim();
    if (!trimmedLastName) throw new BadRequestException('Last name is required');

    const trimmedPhoneNumber = info.phoneNumber.trim();

    if (!trimmedPhoneNumber) throw new BadRequestException('Phone number is required');

    const trimmedEmail = info.email?.trim();
    if (!trimmedEmail) throw new BadRequestException('Email is required');

    const trimmedProfileImageUrl = info.profileImageUrl?.trim();

    return new PersonalInfo({
      firstName: info.firstName,
      lastName: info.lastName,
      phoneNumber: trimmedPhoneNumber,
      email: trimmedEmail,
      profileImageUrl: trimmedProfileImageUrl,
    });
  }
}

export type Info = {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email?: string;
  profileImageUrl?: string;
};
