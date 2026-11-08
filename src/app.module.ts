import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import appConfig from './common/config/app.config';
import databaseConfig from './common/config/database.config';
import redisConfig from './common/config/redis.config';

import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { RoomModule } from './room/room.module';
import { LobbyModule } from './lobby/lobby.module';
import { MatchModule } from './match/match.module';
import { AiModule } from './ai/ai.module';
import { SocialModule } from './social/social.module';
import { AchievementModule } from './achievement/achievement.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { PluginModule } from './plugin/plugin.module';
import { HealthModule } from './health/health.module';
import { WalletModule } from './wallet/wallet.module';
import { EscrowModule } from './core/escrow/escrow.module';
import { PenaltyModule } from './core/penalty/penalty.module';
import { CollectionModule } from './core/collection/collection.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig],
      envFilePath: ['.env'],
      cache: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('database'),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    ScheduleModule.forRoot(),
    AuthModule,
    UserModule,
    RoomModule,
    LobbyModule,
    MatchModule,
    AiModule,
    SocialModule,
    AchievementModule,
    LeaderboardModule,
    PluginModule,
    HealthModule,
    WalletModule,
    EscrowModule,
    PenaltyModule,
    CollectionModule,
    SyncModule,
  ],
})
export class AppModule {}
