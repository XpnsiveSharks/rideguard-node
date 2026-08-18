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
}
