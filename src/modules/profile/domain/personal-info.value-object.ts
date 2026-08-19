export class PersonalInfo {
  private constructor(public readonly info: Info) {}

  static create(props: Info): PersonalInfo {
    const firstName = props.firstName.trim();
    const lastName = props.lastName.trim();
    const phoneNumber = props.phoneNumber.trim();
    const email = props.email.trim().toLowerCase();

    if (!firstName) throw new Error('First name is required');
    if (!lastName) throw new Error('Last name is required');
    if (!phoneNumber) throw new Error('Phone number is required');
    if (!email) throw new Error('Email is required');

    return new PersonalInfo({
      firstName,
      lastName,
      phoneNumber,
      email,
    });
  }
}

type Info = {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email: string;
};
