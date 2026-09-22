import { Controller, Get, Query, Req } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import type { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { GetAlertsQueryDto } from './alerts.dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  // USER ROUTE
  // route: GET /alerts?limit=10&cursor=abc123
  @Public()
  @Get()
  async getAlertsByAssignedUserId(@Req() req: Request, @Query() query: GetAlertsQueryDto) {
    const assignedUserId = req.user?.uid;
    if (!assignedUserId) {
      throw new Error('User ID is missing or invalid.');
    }
    return await this.alertsService.getAlertsByAssignedUserId(
      assignedUserId,
      query.limit,
      query.cursor,
    );
  }
}
