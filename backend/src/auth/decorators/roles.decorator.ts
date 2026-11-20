import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/schemas/user.schema';

export const ROLES_KEY = 'roles';

/**
 * Limits a route to the given roles. Use together with JwtAuthGuard and
 * RolesGuard: @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.ADMIN).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
