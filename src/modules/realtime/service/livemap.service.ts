import { Injectable, Inject } from '@nestjs/common';
import { Rest } from 'ably';
import { ABLY_REST } from '@/infra/ably/ably.constants';

@Injectable()
export class LivemapService {
  constructor(
    @Inject(ABLY_REST)
    private readonly ably: Rest,
  ) {}

  async publishToLivemap(channelName: string, eventName: string, data: any): Promise<void> {
    const channel = this.ably.channels.get(channelName);
    await channel.publish(eventName, data);
  }
}
