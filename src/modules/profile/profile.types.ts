export type CreateProfileInput = {
  uid?: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email?: string;
  profileImageUrl?: string;
  vehicle: {
    vehicleName: string;
    plateNumber: string;
  };
};

export type EmergencyContactInput = {
  contactName?: string;
  phoneNumber?: string;
  relationship?: string;
};
