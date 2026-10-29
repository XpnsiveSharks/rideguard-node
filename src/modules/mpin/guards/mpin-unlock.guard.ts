import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { MpinService } from '../mpin.service';

export const REQUIRE_MPIN_UNLOCK_KEY = 'requireMpinUnlock';
export const RequireMpinUnlock = () => SetMetadata(REQUIRE_MPIN_UNLOCK_KEY, true);

@Injectable()
export class MpinUnlockGuard implements CanActivate {
  constructor(
    private readonly mpinService: MpinService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_MPIN_UNLOCK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const uid = req.user?.uid;
    if (!uid) {
      return true;
    }

    const deviceId = (req.headers['x-device-id'] as string) || undefined;
    const token = (req.headers['x-mpin-unlock-token'] as string) || undefined;

    const unlocked = await this.mpinService.isUnlocked(uid, deviceId, token);
    if (!unlocked) {
      throw new ForbiddenException({
        code: 'MPIN_UNLOCK_REQUIRED',
        message: 'Active MPIN unlock session required to perform this action',
      });
    }

    return true;
  }
}
