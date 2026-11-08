import { Injectable, Logger } from '@nestjs/common';
import { GameState, Action } from '../../plugin/interfaces/game-controller.interface';
import { BoardSyncStrategy } from './board-sync.strategy';
import { CardSyncStrategy } from './card-sync.strategy';

/**
 * 游戏类型枚举
 */
export enum GameType {
  BOARD = 'board',   // 棋类：象棋、围棋、国际象棋等
  CARD = 'card',     // 牌类：斗地主、麻将、德州扑克等
  MIXED = 'mixed',   // 混合类型
}

/**
 * MixedSyncStrategy - 混合同步策略（主策略）
 *
 * 根据游戏类型自动选择board或card策略：
 * - 棋类游戏（BOARD）：使用BoardSyncStrategy，每次操作后发送完整棋盘状态
 * - 牌类游戏（CARD）：使用CardSyncStrategy，发送操作指令+周期性全量校验
 * - 支持策略动态切换
 * - 提供统一的sync接口
 */
@Injectable()
export class MixedSyncStrategy {
  private readonly logger = new Logger(MixedSyncStrategy.name);

  // 房间游戏类型映射
  private readonly roomGameTypes = new Map<string, GameType>();

  // 游戏类型检测规则：pluginId/gameType -> GameType
  private readonly gameTypeRules: Array<{ pattern: RegExp; type: GameType }> = [
    // 棋类游戏关键词
    { pattern: /chess|xiangqi|go|weiqi|shogi|checker|reversi|othello/gi, type: GameType.BOARD },
    // 牌类游戏关键词
    { pattern: /poker|card|mahjong|dou dizhu|texas|blackjack|bridge|uno/gi, type: GameType.CARD },
    // 麻将相关
    { pattern: /mahjong|majong|mj\d*/gi, type: GameType.CARD },
    // 斗地主
    { pattern: /doudizhu|dou\s*di\s*zhu|landlord/gi, type: GameType.CARD },
  ];

  constructor(
    private readonly boardStrategy: BoardSyncStrategy,
    private readonly cardStrategy: CardSyncStrategy,
  ) {}

  /**
   * 统一同步入口 - 根据游戏类型自动选择策略
   */
  async sync(
    roomId: string,
    gameType: GameType,
    action: Action,
    state: GameState,
  ): Promise<void> {
    if (gameType === GameType.BOARD) {
      // 棋类：操作后发送完整状态
      await this.boardStrategy.handleAction(roomId, action, state);
    } else if (gameType === GameType.CARD) {
      // 牌类：发送操作指令+同步可见牌区
      await this.cardStrategy.handleActionWithState(roomId, action, state);
    } else {
      // 默认使用棋类策略
      this.logger.warn(`[MixedSync] Unknown game type "${gameType}", falling back to BOARD strategy`);
      await this.boardStrategy.handleAction(roomId, action, state);
    }
  }

  /**
   * 同步完整状态（用于关键帧或全量校验）
   */
  async syncFullState(roomId: string, state: GameState): Promise<void> {
    const gameType = this.getGameType(roomId);

    if (gameType === GameType.BOARD) {
      await this.boardStrategy.syncFullState(roomId, state);
    } else {
      await this.cardStrategy.syncFullState(roomId, state);
    }
  }

  /**
   * 发送操作指令（增量同步）
   */
  async syncAction(roomId: string, action: Action): Promise<void> {
    const gameType = this.getGameType(roomId);

    if (gameType === GameType.CARD) {
      await this.cardStrategy.syncAction(roomId, action);
    } else {
      // 棋类不单独发送操作指令，而是发送完整状态
      this.logger.debug(`[MixedSync] BOARD game does not support action-only sync, use syncFullState instead`);
    }
  }

  /**
   * 发送关键帧
   */
  async sendKeyframe(roomId: string, state: GameState): Promise<void> {
    const gameType = this.getGameType(roomId);

    if (gameType === GameType.BOARD) {
      await this.boardStrategy.sendKeyframe(roomId, state);
    } else {
      await this.cardStrategy.syncFullState(roomId, state);
    }
  }

  /**
   * 同步不可见牌区哈希（仅牌类）
   */
  async syncHiddenCards(
    roomId: string,
    playerId: string,
    cards: any[],
  ): Promise<{ hash: string }> {
    const gameType = this.getGameType(roomId);

    if (gameType !== GameType.CARD) {
      this.logger.warn(`[MixedSync] HiddenCards sync is only for CARD games`);
      return { hash: '' };
    }

    return this.cardStrategy.syncHiddenCardsHash(roomId, playerId, cards);
  }

  /**
   * 启动定时同步
   */
  startPeriodicSync(
    roomId: string,
    stateProvider: () => GameState,
  ): void {
    const gameType = this.getGameType(roomId);

    if (gameType === GameType.BOARD) {
      this.boardStrategy.startKeyframeTimer(roomId, stateProvider);
    } else if (gameType === GameType.CARD) {
      this.cardStrategy.startFullStateTimer(roomId, stateProvider);
    }
  }

  /**
   * 停止定时同步
   */
  stopPeriodicSync(roomId: string): void {
    this.boardStrategy.stopKeyframeTimer(roomId);
    this.cardStrategy.stopFullStateTimer(roomId);
  }

  /**
   * 注册房间游戏类型
   */
  registerRoom(roomId: string, gameType: GameType | string): void {
    let resolvedType: GameType;

    if (typeof gameType === 'string' && Object.values(GameType).includes(gameType as GameType)) {
      resolvedType = gameType as GameType;
    } else if (typeof gameType === 'string') {
      // 尝试自动检测
      resolvedType = this.detectGameType(gameType);
    } else {
      resolvedType = GameType.BOARD;
    }

    this.roomGameTypes.set(roomId, resolvedType);
    this.logger.log(`[MixedSync] Room=${roomId} registered as ${resolvedType}`);
  }

  /**
   * 动态切换策略
   */
  switchStrategy(roomId: string, newGameType: GameType): void {
    const oldType = this.roomGameTypes.get(roomId);

    if (oldType === newGameType) {
      return;
    }

    // 停止旧策略的定时器
    this.stopPeriodicSync(roomId);

    // 切换类型
    this.roomGameTypes.set(roomId, newGameType);

    this.logger.log(`[MixedSync] Room=${roomId} strategy switched: ${oldType} -> ${newGameType}`);
  }

  /**
   * 获取房间当前游戏类型
   */
  getGameType(roomId: string): GameType {
    return this.roomGameTypes.get(roomId) || GameType.BOARD;
  }

  /**
   * 注销房间
   */
  unregisterRoom(roomId: string): void {
    this.stopPeriodicSync(roomId);
    this.roomGameTypes.delete(roomId);
    this.boardStrategy.cleanup(roomId);
    this.cardStrategy.cleanup(roomId);
    this.logger.log(`[MixedSync] Room=${roomId} unregistered`);
  }

  /**
   * 自动检测游戏类型
   */
  detectGameType(identifier: string): GameType {
    for (const rule of this.gameTypeRules) {
      if (rule.pattern.test(identifier)) {
        return rule.type;
      }
    }

    // 默认返回棋类
    this.logger.warn(`[MixedSync] Could not detect game type for "${identifier}", defaulting to BOARD`);
    return GameType.BOARD;
  }

  /**
   * 获取当前策略
   */
  getCurrentStrategy(roomId: string): 'board' | 'card' {
    const gameType = this.getGameType(roomId);
    return gameType === GameType.CARD ? 'card' : 'board';
  }

  /**
   * 获取内部策略实例（用于高级操作）
   */
  getBoardStrategy(): BoardSyncStrategy {
    return this.boardStrategy;
  }

  getCardStrategy(): CardSyncStrategy {
    return this.cardStrategy;
  }
}
