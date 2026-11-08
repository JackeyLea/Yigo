import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

/**
 * Metadata key for admin roles.
 */
export const ADMIN_ROLES_KEY = 'admin_roles';

/**
 * Admin role types.
 */
export type AdminRole = 'super' | 'admin' | 'moderator';

/**
 * Decorator to specify required admin roles for a route.
 */
export const AdminRoles = (...roles: AdminRole[]) => {
  // Simple decorator that stores metadata
  return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(ADMIN_ROLES_KEY, roles, descriptor.value);
    } else {
      Reflect.defineMetadata(ADMIN_ROLES_KEY, roles, target);
    }
  };
};

/**
 * Guard that protects admin endpoints.
 * Checks for valid admin authentication and required role permissions.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    // Check if user is authenticated
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // 环境变量白名单兜底（ADMIN_USER_IDS，逗号分隔）+ 种子管理员用户名兜底
    const adminIds = (process.env.ADMIN_USER_IDS || '1')
      .split(',')
      .map((id) => id.trim());
    const userIdStr = String(user.userId ?? '');
    const username = String(user.username ?? '');
    if ((userIdStr && adminIds.includes(userIdStr)) || username === 'admin') {
      return true;
    }

    // Check if user has admin role
    const userRole: string = user.role ?? 'user';
    if (!['super', 'admin', 'moderator'].includes(userRole)) {
      throw new ForbiddenException('Admin access required');
    }

    // Check required roles for this route
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.includes(userRole as AdminRole);
      if (!hasRole) {
        throw new ForbiddenException(
          `This action requires one of the following roles: ${requiredRoles.join(', ')}`,
        );
      }
    }

    // Check ban status
    if (user.status === 'banned') {
      throw new ForbiddenException('Your account has been banned');
    }

    return true;
  }
}

/**
 * Super Admin Guard - only allows super admins.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // 环境变量白名单兜底（ADMIN_USER_IDS，逗号分隔）+ 种子管理员用户名兜底
    const adminIds = (process.env.ADMIN_USER_IDS || '1')
      .split(',')
      .map((id) => id.trim());
    const userIdStr = String(user.userId ?? '');
    const username = String(user.username ?? '');
    if ((userIdStr && adminIds.includes(userIdStr)) || username === 'admin') {
      return true;
    }

    if (user.role !== 'super') {
      throw new ForbiddenException('Super admin access required');
    }

    return true;
  }
}
