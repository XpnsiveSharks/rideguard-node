import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { EnvironmentVariables } from '@/config/env.validation';

// Server-to-server auth for internal routes the model-api calls. The caller
// sends the shared key in the X-Service-Key header; there is no Firebase token.
// Mark the route @Public() so the global FirebaseAuthGuard is skipped, then this
// guard enforces the key.
@Injectable()
export class ServiceKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-service-key') ?? '';
    const expected = this.configService.get('DEVICE_RESOLVER_SERVICE_KEY', { infer: true });

    if (!expected || !this.safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid service key');
    }

    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);

    // timingSafeEqual throws on length mismatch, so guard it first.
    if (aBuffer.length !== bBuffer.length) {
      return false;
    }

    return timingSafeEqual(aBuffer, bBuffer);
  }
}
