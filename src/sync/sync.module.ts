import { Module } from '@nestjs/common';
import { EventBus } from '../plugin/event-bus';
import { StateSyncService } from './state-sync.service';
import { BoardSyncStrategy } from './strategies/board-sync.strategy';
import { CardSyncStrategy } from './strategies/card-sync.strategy';
import { MixedSyncStrategy } from './strategies/mixed-sync.strategy';
import { RecorderService } from './replay/recorder.service';
import { ReplayService } from './replay/replay.service';

/**
 * SyncModule - 状态同步模块
 *
 * 提供游戏状态同步的核心功能：
 * - 棋类同步：完整状态快照（BoardSyncStrategy）
 * - 牌类同步：操作指令+周期性校验（CardSyncStrategy）
 * - 混合同步：自动选择策略（MixedSyncStrategy）
 * - 对局录制：操作序列记录（RecorderService）
 * - 回放服务：状态重建与播放控制（ReplayService）
 * - 核心服务：统一接口（StateSyncService）
 */
@Module({
  imports: [],
  providers: [
    // 状态同步策略
    BoardSyncStrategy,
    CardSyncStrategy,
    MixedSyncStrategy,

    // 核心同步服务
    StateSyncService,

    // 录制与回放服务
    RecorderService,
    ReplayService,

    // 依赖（EventBus由PluginModule提供）
    EventBus,
  ],
  exports: [
    // 导出核心服务供其他模块使用
    StateSyncService,
    RecorderService,
    ReplayService,

    // 导出策略（供高级场景直接使用）
    BoardSyncStrategy,
    CardSyncStrategy,
    MixedSyncStrategy,
  ],
})
export class SyncModule {}
