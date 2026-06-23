import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MatchController } from './match.controller';
import { MatchQueueService } from './match-queue.service';
import { MatchEngineService } from './match-engine.service';
import { MatchCleanupService } from './match-cleanup.service';
import { EloService } from './elo.service';

import { PluginModule } from '../plugin/plugin.module';
import { RoomModule } from '../room/room.module';
import { AiModule } from '../ai/ai.module';
import { UserModule } from '../user/user.module';

import { LeaderboardEntry } from '../common/entities/leaderboard-entry.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeaderboardEntry]),
    PluginModule,
    RoomModule,
    AiModule,
    UserModule,
  ],
  controllers: [MatchController],
  providers: [
    MatchQueueService,
    MatchEngineService,
    MatchCleanupService,
    EloService,
  ],
  exports: [
    MatchQueueService,
    MatchEngineService,
    MatchCleanupService,
    EloService,
  ],
})
export class MatchModule {}
