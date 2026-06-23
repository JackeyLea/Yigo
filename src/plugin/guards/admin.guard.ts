import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

export interface AdminUser {
  userId: string;
  username: string;
  roles: string[];
  permissions: string[];
}

/**
 * AdminGuard - 管理员权限守卫
 *
 * 保护插件管理端点，确保只有管理员用户才能访问。
 * 检查用户角色中是否包含 'admin' 或 'super_admin'。
 *
 * 支持配置化的权限检查，可通过构造函数传入自定义角色。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly allowedRoles: string[];
  private readonly requireAll: boolean;

  constructor(options?: { roles?: string[]; requireAll?: boolean }) {
    this.allowedRoles = options?.roles || ['admin', 'super_admin'];
    this.requireAll = options?.requireAll ?? false;
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AdminUser | undefined;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!user.roles || !Array.isArray(user.roles)) {
      throw new ForbiddenException(
        'Access denied: user roles not defined',
      );
    }

    const hasRole = this.requireAll
      ? this.allowedRoles.every((role) => user.roles.includes(role))
      : this.allowedRoles.some((role) => user.roles.includes(role));

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied: requires one of roles [${this.allowedRoles.join(', ')}]`,
      );
    }

    // 检查插件管理特定权限
    if (
      user.permissions &&
      Array.isArray(user.permissions) &&
      !user.permissions.includes('plugin:manage')
    ) {
      throw new ForbiddenException(
        'Access denied: missing plugin:manage permission',
      );
    }

    return true;
  }
}
