/**
 * GatewayModule - WebSocket 网关模块
 *
 * 整合所有WebSocket相关服务，提供实时通信能力。
 * 导入 PluginModule、RoomModule、AuthModule 以支持游戏功能和认证。
 */
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';

import { GameGateway } from './game.gateway';
import { WsJwtGuard } from './guard/ws-jwt.guard';
import { ConnectionManagerService } from './services/connection-manager.service';
import { MessageRouterService } from './services/message-router.service';
import { HeartbeatService } from './services/heartbeat.service';

import { RoomModule } from '../room/room.module';
import { AuthModule } from '../auth/auth.module';
import { PluginModule } from '../plugin/plugin.module';

@Module({
  imports: [
    // 配置模块
    ConfigModule,
    // 调度器模块（用于心跳定时任务）
    ScheduleModule.forRoot(),
    // JWT模块（用于WebSocket认证）
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const keysDir = process.env.JWT_KEYS_DIR || './keys';
        const privateKey = fs.readFileSync(
          path.join(keysDir, 'jwt-private.pem'),
          'utf8',
        );
        const publicKey = fs.readFileSync(
          path.join(keysDir, 'jwt-public.pem'),
          'utf8',
        );
        return {
          privateKey,
          publicKey,
          signOptions: {
            algorithm: 'RS256',
            expiresIn: configService.get<string>('JWT_EXPIRATION', '1h'),
          },
          verifyOptions: {
            algorithms: ['RS256'],
          },
        };
      },
      inject: [ConfigService],
    }),
    // 房间模块（支持房间操作）
    RoomModule,
    // 认证模块（支持JWT验证）
    forwardRef(() => AuthModule),
    // 插件模块（支持游戏功能）
    forwardRef(() => PluginModule),
  ],
  providers: [
    // 核心网关
    GameGateway,
    // 认证守卫
    WsJwtGuard,
    // 连接管理服务
    ConnectionManagerService,
    // 消息路由服务
    MessageRouterService,
    // 心跳管理服务
    HeartbeatService,
  ],
  exports: [
    // 导出服务供其他模块使用
    ConnectionManagerService,
    MessageRouterService,
    HeartbeatService,
    WsJwtGuard,
  ],
})
export class GatewayModule {}
