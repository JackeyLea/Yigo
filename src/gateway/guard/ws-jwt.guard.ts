/**
 * WsJwtGuard - WebSocket JWT 认证守卫
 *
 * 从 WebSocket handshake 的 auth 或 query 中提取 JWT token，
 * 验证 token 的有效性，并将用户信息附加到 client.data 上。
 *
 * 使用方式：
 * - 作为全局守卫在 Gateway 中使用
 * - 或在单个 @SubscribeMessage 方法中使用 @UseGuards(WsJwtGuard)
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import * as fs from 'fs';
import * as path from 'path';

/** JWT Payload 结构 */
interface JwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

/** 认证后的用户信息 */
export interface AuthenticatedUser {
  userId: number;
  username: string;
}

/** Socket.IO 认证数据 */
interface AuthData {
  token?: string;
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);
  private readonly publicKey: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const keysDir = process.env.JWT_KEYS_DIR || './keys';
    this.publicKey = fs.readFileSync(
      path.join(keysDir, 'jwt-public.pem'),
      'utf8',
    );
  }

  /**
   * 验证 WebSocket 连接是否已通过认证
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();

    try {
      const user = await this.authenticate(client);
      if (!user) {
        throw new UnauthorizedException('Invalid token');
      }
      // 将用户信息附加到 socket.data
      client.data.user = user;
      client.data.userId = user.userId;
      return true;
    } catch (error) {
      this.logger.warn(`WebSocket authentication failed: ${error.message}`);

      // 发送认证错误并断开连接
      client.emit('error', {
        code: 'AUTH_FAILED',
        message: 'Authentication failed',
        details: { originalError: error.message },
      });
      client.disconnect(true);

      return false;
    }
  }

  /**
   * 从 Socket 连接中提取并验证 JWT Token
   * @param client - Socket 客户端
   * @returns 认证用户信息，失败返回 null
   */
  async authenticate(client: Socket): Promise<AuthenticatedUser | null> {
    const token = this.extractToken(client);

    if (!token) {
      this.logger.debug('No token found in handshake');
      return null;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
      });

      const user: AuthenticatedUser = {
        userId: Number(payload.sub),
        username: payload.username,
      };

      this.logger.debug(`WebSocket authenticated: userId=${user.userId}, username=${user.username}`);
      return user;
    } catch (error) {
      this.logger.warn(`JWT verification failed: ${error.message}`);
      return null;
    }
  }

  /**
   * 从 Socket handshake 中提取 JWT Token
   * 优先级: auth.token > query.token > query.authorization
   */
  private extractToken(client: Socket): string | undefined {
    // 1. 从 handshake.auth 中提取
    const auth = client.handshake.auth as AuthData;
    if (auth?.token) {
      return auth.token;
    }

    // 2. 从 handshake.query 中提取
    const query = client.handshake.query;
    if (query?.token) {
      const token = Array.isArray(query.token) ? query.token[0] : query.token;
      if (token) return token;
    }

    // 3. 从 query.authorization 中提取（Bearer 格式）
    if (query?.authorization) {
      const auth = Array.isArray(query.authorization)
        ? query.authorization[0]
        : query.authorization;
      if (auth?.startsWith('Bearer ')) {
        return auth.slice(7);
      }
      return auth;
    }

    // 4. 从 handshake.headers.authorization 中提取
    const headerAuth = client.handshake.headers?.authorization;
    if (headerAuth?.startsWith('Bearer ')) {
      return headerAuth.slice(7);
    }

    return undefined;
  }

  /**
   * 从已认证的 Socket 中获取用户信息
   */
  static getUser(client: Socket): AuthenticatedUser | undefined {
    return client.data?.user as AuthenticatedUser | undefined;
  }

  /**
   * 从已认证的 Socket 中获取用户ID
   */
  static getUserId(client: Socket): number | undefined {
    return client.data?.userId as number | undefined;
  }
}
