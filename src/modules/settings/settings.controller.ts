import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SettingsService } from './settings.service';
import { AutoArchiveResponse, UpdateAutoArchiveDto } from './settings.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('auto-archive')
  async getAutoArchive(@Req() req: Request): Promise<AutoArchiveResponse> {
    const uid = req.user?.uid;
    if (!uid) {
      throw new UnauthorizedException('User is not authenticated');
    }

    return this.settingsService.getAutoArchive(uid);
  }

  @Patch('auto-archive')
  async updateAutoArchive(
    @Req() req: Request,
    @Body() body: UpdateAutoArchiveDto,
  ): Promise<AutoArchiveResponse> {
    const uid = req.user?.uid;
    if (!uid) {
      throw new UnauthorizedException('User is not authenticated');
    }

    return this.settingsService.updateAutoArchive(uid, body.autoArchiveHours);
  }
}
