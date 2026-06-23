import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: Error, user: unknown, info: Error) {
    if (err || !user) {
      throw (
        err ||
        new UnauthorizedException(
          info?.message || '未授权，请提供有效的访问令牌',
        )
      );
    }
    return user;
  }
}
