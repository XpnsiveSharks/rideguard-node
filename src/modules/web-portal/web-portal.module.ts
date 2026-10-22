import { Module } from '@nestjs/common';
import { WebPortalController } from './web-portal.controller';
import { WebPortalService } from './web-portal.service';

@Module({
  controllers: [WebPortalController],
  providers: [WebPortalService],
})
export class WebPortalModule {}
