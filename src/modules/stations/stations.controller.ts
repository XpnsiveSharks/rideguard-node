import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '@/common/decorators/roles.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StationsService } from './stations.service';
import type { AuthorityIncident, AuthorityIncidentPage, Station } from './stations.types';

@Controller('authority')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  // OPERATOR / ADMIN ROUTE
  // route: GET /authority/stations
  @Get('stations')
  @UseGuards(RolesGuard)
  @Roles('operator', 'admin')
  async listStations(): Promise<Station[]> {
    return this.stationsService.listStations();
  }

  // OPERATOR / ADMIN ROUTE
  // route: GET /authority/incidents?stationId=<id>&limit=<1-100>&cursor=<incidentId>
  // Operators are scoped to their own stationId claim; admins may query any station.
  @Get('incidents')
  @UseGuards(RolesGuard)
  @Roles('operator', 'admin')
  async listIncidents(
    @Req() req: Request,
    @Query('stationId') stationId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<AuthorityIncidentPage> {
    const user = req.user;
    const role = typeof user?.role === 'string' ? user.role : undefined;
    const claimedStationId =
      typeof user?.stationId === 'string' && user.stationId.trim() ? user.stationId : undefined;

    let targetStationId = stationId ?? claimedStationId;
    if (role === 'operator') {
      if (!claimedStationId) {
        throw new ForbiddenException('An operator must belong to an active station.');
      }
      if (stationId && stationId !== claimedStationId) {
        throw new ForbiddenException('Operators can only view incidents for their own station.');
      }
      targetStationId = claimedStationId;
    }

    if (!targetStationId) {
      throw new BadRequestException('A stationId is required.');
    }

    const pageSize = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException('Limit must be an integer from 1 to 100.');
    }

    return this.stationsService.listIncidents(targetStationId, pageSize, cursor);
  }

  // OPERATOR ROUTE
  // route: PATCH /authority/incidents/:incidentId/read
  @Patch('incidents/:incidentId/read')
  @UseGuards(RolesGuard)
  @Roles('operator')
  async markIncidentRead(
    @Req() req: Request,
    @Param('incidentId') incidentId: string,
  ): Promise<AuthorityIncident> {
    const uid = req.user?.uid;
    const stationId: unknown = req.user?.stationId;
    if (!uid || typeof stationId !== 'string' || !stationId.trim()) {
      throw new ForbiddenException(
        'An operator must belong to an active station to mark an incident read.',
      );
    }

    return this.stationsService.markIncidentRead(incidentId, stationId, uid);
  }

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
