import { Injectable, Logger } from '@nestjs/common';
import { GameState, Action } from '../../plugin/interfaces/game-controller.interface';
import { EventBus } from '../../plugin/event-bus';
import { SyncStateDto, KeyframeSyncDto } from '../dto/sync-state.dto';

/**
 * BoardSyncStrategy - 棋类同步策略
 *
 * 特点：
 * 1. 每次操作后发送完整棋盘状态（JSON格式）
 * 2. 每秒发送一次关键帧（冗余校验）
 * 3. 状态格式：{ board: 二维数组, currentPlayer, moveHistory, metadata }
 * 4. 包含CRC32校验防止传输错误
 */
@Injectable()
export class BoardSyncStrategy {
  private readonly logger = new Logger(BoardSyncStrategy.name);
  private readonly frameCounters = new Map<string, number>();
  private readonly keyframeIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private readonly eventBus: EventBus) {}

  /**
   * 同步完整棋盘状态（每次操作后调用）
   */
  async syncFullState(roomId: string, state: GameState): Promise<void> {
    const frameSeq = this.getNextFrameSeq(roomId);
    const timestamp = Date.now();
    const stateJson = JSON.stringify(state);
    const checksum = this.computeCRC32(stateJson);

    const syncDto: SyncStateDto = {
      roomId,
      state,
      timestamp,
      frameSeq,
      checksum,
    };

    // 广播完整状态到房间所有玩家
    this.eventBus.publishToRoom(roomId, 'sync.board.full_state', syncDto);

    this.logger.debug(
      `[BoardSync] Room=${roomId} Frame=${frameSeq} CRC32=${checksum} Players=${state.players?.length || 0}`,
    );
  }

  /**
   * 发送关键帧（每秒一次，冗余校验用）
   */
  async sendKeyframe(roomId: string, state: GameState): Promise<void> {
    const keyframeSeq = this.getNextFrameSeq(roomId);
    const timestamp = Date.now();
    const stateJson = JSON.stringify(state);
    const checksum = this.computeCRC32(stateJson);

    const keyframeDto: KeyframeSyncDto = {
      roomId,
      state,
      timestamp,
      keyframeSeq,
      checksum,
    };

    // 广播关键帧到房间所有玩家
    this.eventBus.publishToRoom(roomId, 'sync.board.keyframe', keyframeDto);

    this.logger.debug(
      `[BoardSync] Keyframe Room=${roomId} Seq=${keyframeSeq} CRC32=${checksum}`,
    );
  }

  /**
   * 启动关键帧定时器（每秒发送一次）
   */
  startKeyframeTimer(roomId: string, stateProvider: () => GameState): void {
    // 防止重复启动
    if (this.keyframeIntervals.has(roomId)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const state = stateProvider();
        if (state) {
          await this.sendKeyframe(roomId, state);
        }
      } catch (error) {
        this.logger.error(
          `[BoardSync] Keyframe error Room=${roomId}: ${error.message}`,
        );
      }
    }, 1000); // 每秒一次

    this.keyframeIntervals.set(roomId, interval);

    this.logger.log(`[BoardSync] Keyframe timer started for Room=${roomId}`);
  }

  /**
   * 停止关键帧定时器
   */
  stopKeyframeTimer(roomId: string): void {
    const interval = this.keyframeIntervals.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.keyframeIntervals.delete(roomId);
      this.frameCounters.delete(roomId);
      this.logger.log(`[BoardSync] Keyframe timer stopped for Room=${roomId}`);
    }
  }

  /**
   * 处理玩家操作并广播更新后的完整状态
   */
  async handleAction(roomId: string, action: Action, newState: GameState): Promise<void> {
    // 棋类游戏：操作后发送完整状态
    await this.syncFullState(roomId, newState);
  }

  /**
   * 获取帧序号
   */
  private getNextFrameSeq(roomId: string): number {
    const current = this.frameCounters.get(roomId) || 0;
    const next = current + 1;
    this.frameCounters.set(roomId, next);
    return next;
  }

  /**
   * 计算CRC32校验值
   */
  computeCRC32(data: string): string {
    const CRC32_POLYNOMIAL = 0xEDB88320;
    let crc = 0xFFFFFFFF;

    // 使用查找表加速计算
    const table = this.getCRC32Table();

    for (let i = 0; i < data.length; i++) {
      const byte = data.charCodeAt(i);
      crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }

    crc = crc ^ 0xFFFFFFFF;

    // 返回无符号32位整数的十六进制字符串
    return (crc >>> 0).toString(16).padStart(8, '0');
  }

  private crc32Table: number[] | null = null;

  private getCRC32Table(): number[] {
    if (this.crc32Table) {
      return this.crc32Table;
    }

    const CRC32_POLYNOMIAL = 0xEDB88320;
    const table: number[] = new Array(256);

    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 1) ? ((crc >>> 1) ^ CRC32_POLYNOMIAL) : (crc >>> 1);
      }
      table[i] = crc >>> 0;
    }

    this.crc32Table = table;
    return table;
  }

  /**
   * 清理房间资源
   */
  cleanup(roomId: string): void {
    this.stopKeyframeTimer(roomId);
    this.frameCounters.delete(roomId);
  }

  /**
   * 获取当前帧序号
   */
  getCurrentFrameSeq(roomId: string): number {
    return this.frameCounters.get(roomId) || 0;
  }
}
