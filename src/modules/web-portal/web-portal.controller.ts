import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import {
  SubmitApplicationDto,
  ReviewApplicationDto,
  TransitionIncidentDto,
  IncidentNoteDto,
  StaffRoleDto,
  StaffStatusDto,
} from './web-portal.dto';
import { WebPortalService } from './web-portal.service';

@Controller('web')
export class WebPortalController {
  constructor(private readonly service: WebPortalService) {}

  @Get('session')
  session(@Req() req: Request) {
    return this.service.session(req.user);
  }

  @Public()
  @Post('applications')
  submitApplication(@Body() body: SubmitApplicationDto) {
    return this.service.submitApplication(body);
  }

  @Get('applications')
  applications(@Req() req: Request) {
    return this.service.applications(req.user);
  }

  @Patch('applications/:id/review')
  reviewApplication(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ReviewApplicationDto,
  ) {
    return this.service.reviewApplication(req.user, id, body);
  }

  @Get('organization')
  organization(@Req() req: Request) {
    return this.service.organization(req.user);
  }

  @Get('staff')
  staff(@Req() req: Request) {
    return this.service.staff(req.user);
  }

  @Patch('staff/:uid/role')
  changeStaffRole(@Req() req: Request, @Param('uid') uid: string, @Body() body: StaffRoleDto) {
    return this.service.changeStaffRole(req.user, uid, body.role);
  }

  @Patch('staff/:uid/status')
  changeStaffStatus(@Req() req: Request, @Param('uid') uid: string, @Body() body: StaffStatusDto) {
    return this.service.changeStaffStatus(req.user, uid, body.status);
  }

  @Get('incidents')
  incidents(@Req() req: Request) {
    return this.service.incidents(req.user);
  }

  @Get('incidents/:id')
  incident(@Req() req: Request, @Param('id') id: string) {
    return this.service.incident(req.user, id);
  }

  @Patch('incidents/:id/status')
  transitionIncident(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: TransitionIncidentDto,
  ) {
    return this.service.transitionIncident(req.user, id, body);
  }

  @Post('incidents/:id/notes')
  addNote(@Req() req: Request, @Param('id') id: string, @Body() body: IncidentNoteDto) {
    return this.service.addNote(req.user, id, body.text);
  }

  @Get('locations')
  locations(@Req() req: Request) {
    return this.service.locations(req.user);
  }

  @Post('demo/location/:action')
  demoLocation(@Req() req: Request, @Param('action') action: string) {
    return this.service.demoLocation(req.user, action);
  }

  @Get('audit')
  audit(@Req() req: Request) {
    return this.service.audit(req.user);
  }
}
