import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { Alert } from './domain/alerts.entity';
import type { Request } from 'express';
import { GetAlertsQueryDto, UpdateAlertFalseAlarmDto, UpdateAlertSeenDto } from './alerts.dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  // USER ROUTE
  // route: GET /alerts?limit=10&cursor=abc123
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

  // USER ROUTE
  // route: PATCH /alerts/:alertId/seen
  @Patch(':alertId/seen')
  async updateAlertSeen(
    @Param('alertId') alertId: string,
    @Body() body: UpdateAlertSeenDto,
    @Req() req: Request,
  ): Promise<Alert> {
    const assignedUserId = req.user?.uid;
    if (!assignedUserId) {
      throw new UnauthorizedException('User ID is missing or invalid.');
    }

    return await this.alertsService.updateAlertSeen(alertId, assignedUserId, body.isSeen);
  }

  // USER ROUTE
  // route: PATCH /alerts/:alertId/false-alarm
  @Patch(':alertId/false-alarm')
  async updateAlertFalseAlarm(
    @Param('alertId') alertId: string,
    @Body() body: UpdateAlertFalseAlarmDto,
    @Req() req: Request,
  ): Promise<Alert> {
    const assignedUserId = req.user?.uid;
    if (!assignedUserId) {
      throw new UnauthorizedException('User ID is missing or invalid.');
    }

    return await this.alertsService.updateAlertFalseAlarm(
      alertId,
      assignedUserId,
      body.isFalseAlarm,
    );
  }
}
