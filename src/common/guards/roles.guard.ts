import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';

// Runs after the global FirebaseAuthGuard, which sets request.user. Checks the
// `role` custom claim on the verified token against the roles a route requires.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const role = typeof user.role === 'string' ? user.role : undefined;

    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException('You are not allowed to perform this action');
    }

    return true;
  }
}
