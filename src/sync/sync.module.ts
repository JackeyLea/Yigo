/**
 * SyncModule - 观战同步模块
 *
 * 提供观战延迟同步、聊天隔离、视角切换功能。
 */
import { Module } from '@nestjs/common';
import { SpectatorSyncService } from './spectator-sync.service';

@Module({
  providers: [SpectatorSyncService],
  exports: [SpectatorSyncService],
})
export class SyncModule {}
