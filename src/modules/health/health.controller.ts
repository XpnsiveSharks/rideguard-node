import { Controller, Get } from '@nestjs/common';
import { Public } from '@/common/decorators/public.decorator';
import { ResponseMessage } from '@/common/decorators/response-message.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // route: GET /health/firestore
  @Public()
  @Get('firestore')
  @ResponseMessage('Firestore connection is healthy')
  checkFirestore() {
    return this.healthService.checkFirestore();
  }

  // route: GET /health/ably
  @Public()
  @Get('ably')
  @ResponseMessage('Ably connection is healthy')
  checkAbly() {
    return this.healthService.checkAbly();
  }
}
