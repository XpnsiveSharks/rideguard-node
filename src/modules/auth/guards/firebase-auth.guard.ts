import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { AuthService } from '../auth.service';
import { ALLOW_DURING_DELETION_KEY } from '../account-deletion.decorator';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      request.user = await this.authService.verifyToken(header.slice(7));
      if (!request.user.email_verified) {
        throw new UnauthorizedException('Email verification required');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }

    const allowDuringDeletion = this.reflector.getAllAndOverride<boolean>(
      ALLOW_DURING_DELETION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!allowDuringDeletion) {
      const isScheduled = await this.authService.isDeletionScheduled(request.user.uid);
      if (isScheduled) {
        throw new ForbiddenException('Account is scheduled for deletion');
      }
    }

    return true;
  }
}
