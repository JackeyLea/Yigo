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
  private allowedRoles: string[] = ['admin', 'super_admin'];
  private requireAll = false;

  /**
   * 配置守卫选项（替代构造函数注入，避免 DI 无法解析可选参数）
   */
  configure(options?: { roles?: string[]; requireAll?: boolean }): this {
    if (options?.roles) {
      this.allowedRoles = options.roles;
    }
    if (options?.requireAll !== undefined) {
      this.requireAll = options.requireAll;
    }
    return this;
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AdminUser | undefined;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // 环境变量白名单兜底（ADMIN_USER_IDS，逗号分隔）+ 种子管理员用户名兜底
    const adminIds = (process.env.ADMIN_USER_IDS || '1')
      .split(',')
      .map((id) => id.trim());
    const userIdStr = String((user as any).userId ?? '');
    const username = String((user as any).username ?? '');
    if ((userIdStr && adminIds.includes(userIdStr)) || username === 'admin') {
      return true;
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
