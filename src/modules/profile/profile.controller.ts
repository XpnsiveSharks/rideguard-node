import { Controller, Post, Body, Req } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { CreateProfileDto } from './profile.dto';
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
    return this.profileService.createProfile(
      {
        uid: req.user?.uid,
        firstName: body.first_name,
        lastName: body.last_name,
        email: req.user?.email,
        phoneNumber: body.phone_number,
        profileImageUrl: req.user?.picture,
        vehicle: {
          vehicleName: body.vehicle,
          plateNumber: body.plate_number,
        },
      },
      {
        contactName: body.contact_name,
        phoneNumber: body.emergency_phone_number,
        relationship: body.relationship,
      },
    );
  }
}
