import { Controller, Get, Req } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import type { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  // USER ROUTE
  // route: GET /alerts
  @Public()
  @Get()
  async getAlertsByAssignedUserId(@Req() req: Request) {
    const assignedUserId = 'CyzbiM3ld2eomEfaudjLy4vklBd2';
    // const assignedUserId = req.user?.uid;
    if (!assignedUserId) {
      throw new Error('User ID is missing or invalid.');
    }
    return await this.alertsService.getAlertsByAssignedUserId(assignedUserId);
  }
}
