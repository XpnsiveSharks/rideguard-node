import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProfileService } from './profile.service';
import { CreateEmergencyContactDto, CreateProfileDto } from './profile.dto';
import type { Request } from 'express';
import { EmergencyContactDto, UpdateEmergencyContactDto } from './contacts.dto';
import { profilePhotoUploadOptions } from './profile.upload';
import type { UploadedPhoto } from './profile.upload';
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
      personalInfoFields: {
        firstName: body.first_name,
        lastName: body.last_name,
        phoneNumber: body.phone_number,
        email: req.user?.email,
        profileImageUrl: req.user?.picture,
      },
      vehicleInfoFields: {
        brand: body.brand,
        model: body.model,
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

  @Get('me')
  getProfile(@Req() req: Request) {
    return this.profileService.getProfile(req.user?.uid as string);
  }

  // POST /profile/photo; multipart/form-data photo=<jpeg|png|webp>, max 5 MB.
  @Post('photo')
  @UseInterceptors(FileInterceptor('photo', profilePhotoUploadOptions))
  uploadProfilePhoto(@Req() req: Request, @UploadedFile() file: UploadedPhoto) {
    return this.profileService.uploadProfilePhoto(req.user?.uid as string, file);
  }

  @Get('emergency-contacts')
  listContacts(@Req() req: Request) {
    return this.profileService.listContacts(req.user?.uid as string);
  }

  // POST /profile/emergency-contacts; multipart/form-data name, phone, relationship, photo?.
  @Post('emergency-contacts')
  @UseInterceptors(FileInterceptor('photo', profilePhotoUploadOptions))
  createContact(
    @Req() req: Request,
    @Body() body: EmergencyContactDto,
    @UploadedFile() file?: UploadedPhoto,
  ) {
    return this.profileService.createContact(req.user?.uid as string, body, file);
  }

  @Get('emergency-contacts/:id')
  getContact(@Req() req: Request, @Param('id') id: string) {
    return this.profileService.getContact(req.user?.uid as string, id);
  }

  // PATCH /profile/emergency-contacts/:id; multipart/form-data changed fields, photo?.
  @Patch('emergency-contacts/:id')
  @UseInterceptors(FileInterceptor('photo', profilePhotoUploadOptions))
  updateContact(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateEmergencyContactDto,
    @UploadedFile() file?: UploadedPhoto,
  ) {
    return this.profileService.updateContact(req.user?.uid as string, id, body, file);
  }

  @Delete('emergency-contacts/:id')
  async deleteContact(@Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.profileService.deleteContact(req.user?.uid as string, id);
  }
}
