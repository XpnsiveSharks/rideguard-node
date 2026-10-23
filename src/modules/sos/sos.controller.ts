import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { StartSosDto } from './sos.dto';
import { SosService } from './sos.service';
import type { PublicSos } from './sos.types';

function requireUid(req: Request): string {
  const uid = req.user?.uid;
  if (!uid) {
    throw new UnauthorizedException('User ID is missing or invalid.');
  }
  return uid;
}

@Controller('sos')
export class SosController {
  constructor(private readonly sosService: SosService) {}

  // USER ROUTE
  // route: POST /sos  (201 when created, 200 on replay or existing active SOS)
  @Post()
  async start(
    @Req() req: Request,
    @Body() body: StartSosDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicSos> {
    const { sos, created } = await this.sosService.start(requireUid(req), body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return sos;
  }

  // Static routes stay above `:sosId`.
  // USER ROUTE
  // route: GET /sos/active
  @Get('active')
  getActive(@Req() req: Request): Promise<PublicSos | null> {
    return this.sosService.getActive(requireUid(req));
  }

  @Get('by-request/:requestId')
  getByRequest(
    @Req() req: Request,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ): Promise<PublicSos> {
    return this.sosService.getByRequest(requireUid(req), requestId);
  }

  // USER ROUTE
  // route: GET /sos/:sosId
  @Get(':sosId')
  getOne(@Req() req: Request, @Param('sosId') sosId: string): Promise<PublicSos> {
    return this.sosService.getOwned(requireUid(req), sosId);
  }

  // USER ROUTE
  // route: POST /sos/:sosId/stop  (idempotent)
  @Post(':sosId/stop')
  @HttpCode(HttpStatus.OK)
  stop(@Req() req: Request, @Param('sosId') sosId: string): Promise<PublicSos> {
    return this.sosService.stop(requireUid(req), sosId);
  }
}

// Kept in SosModule so AlertsModule does not depend on SOS dispatch.
@Controller('alerts')
export class AlertSosController {
  constructor(private readonly sosService: SosService) {}

  @Get(':alertId/sos')
  getByAlert(@Req() req: Request, @Param('alertId') alertId: string): Promise<PublicSos | null> {
    return this.sosService.getByAlert(requireUid(req), alertId);
  }
}
