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
import type { Request } from 'express';
import { GetAlertsQueryDto, UpdateAlertSeenDto } from './alerts.dto';

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
  ): Promise<void> {
    const assignedUserId = req.user?.uid;
    if (!assignedUserId) {
      throw new UnauthorizedException('User ID is missing or invalid.');
    }

    await this.alertsService.updateAlertSeen(alertId, assignedUserId, body.isSeen);
  }
}
