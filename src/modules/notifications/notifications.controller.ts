import { Controller, Body, Post, Req } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RegisterPushNotificationDto } from './notifications.dto';
import type { Request } from 'express';
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // route: POST /notifications/register
  @Post('register')
  async registerPushNotification(
    @Req() req: Request,
    @Body() body: RegisterPushNotificationDto,
  ): Promise<void> {
    await this.notificationsService.registerPushNotification({
      userId: req.user?.uid || '',
      installationId: body.installationId,
      registrationId: body.registrationId,
      platform: body.platform,
      deviceName: body.deviceName,
    });
  }
}
