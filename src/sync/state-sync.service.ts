import { Injectable, Logger } from '@nestjs/common';
import { GameState, Action } from '../plugin/interfaces/game-controller.interface';
import { EventBus } from '../plugin/event-bus';
import { MixedSyncStrategy, GameType } from './strategies/mixed-sync.strategy';
import { CardSyncStrategy } from './strategies/card-sync.strategy';
import { BoardSyncStrategy } from './strategies/board-sync.strategy';

/**
 * Card 接口定义
 */
export interface Card {
  suit: string;
  rank: string;
  id?: string;
}

/**
 * StateSyncService - 状态同步核心服务
 *
 * 提供棋类和牌类的状态同步功能：
 * 1. 棋类同步：完整状态快照（每次操作后广播完整棋盘）
 * 2. 牌类同步：混合同步（操作指令 + 周期性全量校验）
 * 3. 不可见牌区哈希同步（HMAC-SHA256防作弊）
 * 4. 关键帧全量同步（每秒1次）
 * 5. 增量同步（操作指令）
 * 6. 观战延迟推送
 */
@Injectable()
export class StateSyncService {
  private readonly logger = new Logger(StateSyncService.name);

  // 观战延迟配置（秒）
  private readonly SPECTATOR_DELAY_SECONDS = 5;

  // 帧序号管理
  private readonly frameCounters = new Map<string, number>();

  // 状态提供者（外部注册，用于定时同步获取最新状态）
  private readonly stateProviders = new Map<string, () => GameState>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly mixedStrategy: MixedSyncStrategy,
    private readonly cardStrategy: CardSyncStrategy,
    private readonly boardStrategy: BoardSyncStrategy,
  ) {}

  // ==================== 棋类同步 ====================

  /**
   * 棋类同步 - 每次操作后广播完整棋盘状态
   * @param roomId 房间ID
   * @param state 完整游戏状态（包含board二维数组、currentPlayer、moveHistory、metadata）
   */
  async syncBoardGame(roomId: string, state: GameState): Promise<void> {
    try {
      await this.boardStrategy.syncFullState(roomId, state);

      this.logger.debug(
        `[StateSync] BoardGame synced Room=${roomId} ` +
        `Status=${state.status} CurrentPlayer=${state.currentPlayer}`,
      );
    } catch (error) {
      this.logger.error(
        `[StateSync] Failed to sync board game Room=${roomId}: ${error.message}`,
      );
      throw error;
    }
  }

  // ==================== 牌类同步 ====================

  /**
   * 牌类同步 - 发送操作指令（增量同步）
   * @param roomId 房间ID
   * @param action 操作指令
   */
  async syncCardGame(roomId: string, action: Action): Promise<void> {
    try {
      await this.cardStrategy.syncAction(roomId, action);

      this.logger.debug(
        `[StateSync] CardGame action synced Room=${roomId} ` +
        `ActionType=${action.type} Player=${action.playerId}`,
      );
    } catch (error) {
      this.logger.error(
        `[StateSync] Failed to sync card game action Room=${roomId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * 牌类同步 - 发送完整状态（周期性校验用）
   * @param roomId 房间ID
   * @param state 完整游戏状态
   */
  async syncCardGameFullState(roomId: string, state: GameState): Promise<void> {
    try {
      await this.cardStrategy.syncFullState(roomId, state);

      this.logger.debug(
        `[StateSync] CardGame full state synced Room=${roomId} ` +
        `Status=${state.status}`,
      );
    } catch (error) {
      this.logger.error(
        `[StateSync] Failed to sync card game full state Room=${roomId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * 同步不可见牌区哈希（HMAC-SHA256防作弊）
   * @param roomId 房间ID
   * @param playerId 玩家ID
   * @param cards 牌组
   * @returns 哈希值对象
   */
  async syncHiddenCards(
    roomId: string,
    playerId: string,
    cards: Card[],
  ): Promise<{ hash: string }> {
    try {
      const result = await this.cardStrategy.syncHiddenCardsHash(roomId, playerId, cards);

      this.logger.debug(
        `[StateSync] HiddenCards hash synced Room=${roomId} ` +
        `Player=${playerId} Hash=${result.hash.substring(0, 16)}...`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[StateSync] Failed to sync hidden cards Room=${roomId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * 生成HMAC哈希
   * @param cards 牌组
   * @param key 32字节HMAC密钥
   * @param nonce 16字节nonce
   * @returns HMAC-SHA256哈希值
   */
  generateCardHash(cards: Card[], key: Buffer, nonce: Buffer): string {
    return this.cardStrategy.generateCardHash(cards, key, nonce);
  }

  // ==================== 关键帧同步 ====================

  /**
   * 关键帧全量同步 - 每秒1次（冗余校验用）
   * @param roomId 房间ID
   * @param state 完整游戏状态
   */
  async sendKeyframe(roomId: string, state: GameState): Promise<void> {
    try {
      const gameType = this.mixedStrategy.getGameType(roomId);

      if (gameType === GameType.BOARD) {
        await this.boardStrategy.sendKeyframe(roomId, state);
      } else {
        await this.cardStrategy.syncFullState(roomId, state);
      }

      this.logger.debug(
        `[StateSync] Keyframe sent Room=${roomId} GameType=${gameType}`,
      );
    } catch (error) {
      this.logger.error(
        `[StateSync] Failed to send keyframe Room=${roomId}: ${error.message}`,
      );
      throw error;
    }
  }

  // ==================== 增量同步 ====================

  /**
   * 增量同步 - 发送Action对象（操作指令）
   * @param roomId 房间ID
   * @param action 操作指令
   */
  async sendDelta(roomId: string, action: Action): Promise<void> {
    try {
      const gameType = this.mixedStrategy.getGameType(roomId);

      if (gameType === GameType.CARD) {
        // 牌类：发送操作指令
        await this.cardStrategy.syncAction(roomId, action);
      } else {
        // 棋类：获取最新状态后发送完整状态
        const stateProvider = this.stateProviders.get(roomId);
        if (stateProvider) {
          const state = stateProvider();
          await this.boardStrategy.syncFullState(roomId, state);
        } else {
          this.logger.warn(
            `[StateSync] No state provider for Room=${roomId}, cannot send delta`,
          );
        }
      }

      this.logger.debug(
        `[StateSync] Delta sent Room=${roomId} ActionType=${action.type}`,
      );
    } catch (error) {
      this.logger.error(
        `[StateSync] Failed to send delta Room=${roomId}: ${error.message}`,
      );
      throw error;
    }
  }

  // ==================== 观战延迟推送 ====================

  /**
   * 观战延迟推送
   * 观战者延迟5秒接收状态更新，避免实时看到手牌等敏感信息
   * @param roomId 房间ID
   * @param state 游戏状态
   */
  async spectatePush(roomId: string, state: GameState): Promise<void> {
    try {
      // 过滤敏感信息
      const spectatorState = this.filterSpectatorState(state);

      // 延迟推送
      setTimeout(() => {
        this.eventBus.publishToRoom(roomId, 'sync.spectator.state', {
          roomId,
          timestamp: Date.now(),
          delaySeconds: this.SPECTATOR_DELAY_SECONDS,
          state: spectatorState,
        });

        this.logger.debug(
          `[StateSync] Spectator push Room=${roomId} ` +
          `Delay=${this.SPECTATOR_DELAY_SECONDS}s`,
        );
      }, this.SPECTATOR_DELAY_SECONDS * 1000);
    } catch (error) {
      this.logger.error(
        `[StateSync] Failed to push spectator state Room=${roomId}: ${error.message}`,
      );
      throw error;
    }
  }

  // ==================== 房间生命周期管理 ====================

  /**
   * 注册房间到同步服务
   * @param roomId 房间ID
   * @param gameType 游戏类型（board/card）
   * @param stateProvider 状态提供者函数
   */
  registerRoom(
    roomId: string,
    gameType: GameType | string,
    stateProvider?: () => GameState,
  ): void {
    // 注册到混合策略
    this.mixedStrategy.registerRoom(roomId, gameType);

    // 注册状态提供者
    if (stateProvider) {
      this.stateProviders.set(roomId, stateProvider);
    }

    // 启动定时同步
    const provider = () => {
      const fn = this.stateProviders.get(roomId);
      return fn ? fn() : null;
    };
    this.mixedStrategy.startPeriodicSync(roomId, provider);

    this.logger.log(`[StateSync] Room registered Room=${roomId} GameType=${gameType}`);
  }

  /**
   * 注销房间
   * @param roomId 房间ID
   */
  unregisterRoom(roomId: string): void {
    // 停止定时同步
    this.mixedStrategy.stopPeriodicSync(roomId);
    this.mixedStrategy.unregisterRoom(roomId);

    // 清理状态提供者
    this.stateProviders.delete(roomId);
    this.frameCounters.delete(roomId);

    this.logger.log(`[StateSync] Room unregistered Room=${roomId}`);
  }

  /**
   * 动态切换游戏类型
   * @param roomId 房间ID
   * @param newGameType 新的游戏类型
   */
  switchGameType(roomId: string, newGameType: GameType): void {
    this.mixedStrategy.switchStrategy(roomId, newGameType);
    this.logger.log(`[StateSync] GameType switched Room=${roomId} -> ${newGameType}`);
  }

  /**
   * 注册状态提供者
   */
  registerStateProvider(roomId: string, provider: () => GameState): void {
    this.stateProviders.set(roomId, provider);
  }

  // ==================== 辅助方法 ====================

  /**
   * 过滤观战状态（移除敏感信息）
   */
  private filterSpectatorState(state: GameState): GameState {
    return {
      ...state,
      metadata: {
        ...state.metadata,
        // 移除所有手牌信息
        hiddenCards: undefined,
        playerHands: undefined,
        deck: undefined,
        // 保留公开信息
        round: state.metadata?.round,
        phase: state.metadata?.phase,
        pot: state.metadata?.pot,
        boardCards: state.metadata?.boardCards,
        discardPile: state.metadata?.discardPile,
      },
      // 过滤玩家手牌
      players: state.players?.map((p) => ({
        ...p,
        metadata: {
          ...p.metadata,
          hand: undefined,
          privateCards: undefined,
          // 保留公开metadata
          score: p.metadata?.score,
          status: p.metadata?.status,
        },
      })),
    };
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
}
