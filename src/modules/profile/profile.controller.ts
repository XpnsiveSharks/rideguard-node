import { Controller, Post, Body, Req } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { CreateEmergencyContactDto, CreateProfileDto } from './profile.dto';
import type { Request } from 'express';
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // route: POST /profile/personal-info
  @Post('personal-info')
  createProfileInfo(
    @Req() req: Request,
    @Body()
    body: CreateProfileDto,
  ) {
    return this.profileService.createProfile({
      uid: req.user?.uid,
      personalInfo: {
        firstName: body.first_name,
        lastName: body.last_name,
        phoneNumber: body.phone_number,
        email: req.user?.email,
        profileImageUrl: req.user?.picture,
      },
      vehicleInfo: {
        vehicleName: body.vehicle,
        plateNumber: body.plate_number,
        color: body.color,
      },
      emergencyContactFields: {
        contactName: body.contact_name,
        phoneNumber: body.emergency_phone_number,
        relationship: body.relationship,
      },
    });
  }

  // route: POST /profile/emergency-contact
  @Post('emergency-contact')
  createEmergencyContact(@Req() req: Request, @Body() body: CreateEmergencyContactDto) {
    return this.profileService.createEmergencyContact(req.user?.uid, {
      contactName: body.contact_name,
      phoneNumber: body.emergency_phone_number,
      relationship: body.relationship,
    });
  }
}
