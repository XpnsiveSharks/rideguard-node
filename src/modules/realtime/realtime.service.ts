import { Injectable } from '@nestjs/common';
import { RealtimePublisherService } from './service/realtime-publishing.service';

@Injectable()
export class RealtimeService {
  constructor(private readonly realtimePublisherService: RealtimePublisherService) {}

  async publishAlert(channelName: string, data: any): Promise<void> {
    await this.realtimePublisherService.publishAlert(channelName, data);
  }
}
