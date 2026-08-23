import { BadRequestException } from '@nestjs/common';

export class PersonalInfo {
  private constructor(public readonly info: Info) {}

  static create(props: Info): PersonalInfo {
    const phoneNumber = props.phoneNumber.trim();
    const email = props.email?.trim();
    const profileImageUrl = props.profileImageUrl?.trim();

    if (!props.firstName.trim()) throw new BadRequestException('First name is required');
    if (!props.lastName.trim()) throw new BadRequestException('Last name is required');
    if (!phoneNumber) throw new BadRequestException('Phone number is required');
    if (!email) throw new BadRequestException('Email is required');

    return new PersonalInfo({
      firstName: props.firstName,
      lastName: props.lastName,
      phoneNumber,
      email,
      profileImageUrl,
    });
  }
}

type Info = {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email?: string;
  profileImageUrl?: string;
};
