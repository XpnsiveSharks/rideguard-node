import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Restricts a route to callers whose Firebase token carries one of these roles.
// A valid token alone is not enough; RolesGuard enforces the role claim.
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
