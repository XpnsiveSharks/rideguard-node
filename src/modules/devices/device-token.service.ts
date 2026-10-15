import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Rest } from 'ably';
import { ABLY_DEVICE_ISSUER } from '@/infra/ably/ably.constants';
import { ONE_HOUR_IN_MILLISECONDS } from '@/common/constants/time.constants';
import { REALTIME_CHANNELS } from '@/modules/realtime/realtime.constants';
import { DevicesService } from './devices.service';
import { DeviceType } from './domain/device.entity';
import type { DevicePublisherTokenResult } from './devices.types';

@Injectable()
export class DeviceTokenService {
  constructor(
    private readonly devicesService: DevicesService,
    @Inject(ABLY_DEVICE_ISSUER) private readonly issuer: Rest,
  ) {}

  async issuePublisherToken(
    deviceId: string,
    authorization: string | undefined,
  ): Promise<DevicePublisherTokenResult> {
    const secret = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!secret) {
      throw new UnauthorizedException('Invalid device credentials');
    }

    const device = await this.devicesService.verifyDeviceCredentials(deviceId, secret);
    if (device.getDeviceType() !== DeviceType.BUTTON) {
      throw new ForbiddenException('Publisher tokens are only available to button devices');
    }

    const channel = REALTIME_CHANNELS.buttonEvents;
    try {
      const details = await this.issuer.auth.requestToken({
        clientId: device.getDeviceId(),
        ttl: ONE_HOUR_IN_MILLISECONDS,
        capability: JSON.stringify({ [channel]: ['publish'] }),
      });

      return {
        token: details.token,
        issued: details.issued,
        expires: details.expires,
        clientId: details.clientId,
        capability: details.capability,
        channel,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Unable to issue device token. Please try again later.',
      );
    }
  }
}
