import { Controller, ForbiddenException, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '@/common/decorators/roles.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StationsService } from './stations.service';

@Controller('authority')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  // OPERATOR ROUTE
  // route: POST /authority/incidents/:incidentId/acknowledge
  // The station comes only from the `stationId` custom claim, never the request,
  // so an operator cannot claim lead on behalf of another station.
  @Post('incidents/:incidentId/acknowledge')
  @UseGuards(RolesGuard)
  @Roles('operator')
  async acknowledgeIncident(@Req() req: Request, @Param('incidentId') incidentId: string) {
    const uid = req.user?.uid;
    const stationId: unknown = req.user?.stationId;
    if (!uid || typeof stationId !== 'string' || !stationId.trim()) {
      throw new ForbiddenException('An operator must belong to an active station to acknowledge.');
    }

    return this.stationsService.acknowledgeLead({ incidentId, stationId, actorUid: uid });
  }
}
