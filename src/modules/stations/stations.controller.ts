import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '@/common/decorators/roles.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StationsService } from './stations.service';

@Controller('authority')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Post('incidents/:incidentId/acknowledge')
  @UseGuards(RolesGuard)
  @Roles('operator', 'admin')
  async acknowledgeIncident(
    @Req() req: Request & { user?: { uid: string; role?: string; stationId?: string } },
    @Param('incidentId') incidentId: string,
    @Body('stationId') stationId?: string,
  ) {
    const userRole = req.user?.role;
    const activeStationId = req.user?.stationId ?? stationId;

    if (!userRole || !['operator', 'admin'].includes(userRole)) {
      throw new ForbiddenException('You are not allowed to acknowledge incidents.');
    }

    if (userRole === 'operator' && !activeStationId) {
      throw new ForbiddenException(
        'An operator must belong to an active station to acknowledge.',
      );
    }

    return this.stationsService.acknowledgeLead({
      incidentId,
      stationId: activeStationId ?? '',
      actorUid: req.user?.uid ?? 'system',
    });
  }
}
