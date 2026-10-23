import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
