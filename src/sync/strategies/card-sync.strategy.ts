import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { GameState, Action } from '../../plugin/interfaces/game-controller.interface';
import { EventBus } from '../../plugin/event-bus';
import { SyncActionDto, SyncStateDto, HiddenCardsHashDto, Card } from '../dto/sync-state.dto';

/**
 * CardSyncStrategy - 牌类同步策略
 *
 * 特点：
 * 1. 发送操作指令（Action）而非完整状态（增量同步）
 * 2. 每5秒发送一次完整状态校验
 * 3. 不可见牌区发送HMAC-SHA256哈希（防作弊）
 * 4. 可见牌区明文同步
 * 5. HMAC密钥：每局独立32字节密钥+16字节nonce，局后销毁
 */
@Injectable()
export class CardSyncStrategy {
  private readonly logger = new Logger(CardSyncStrategy.name);
  private readonly frameCounters = new Map<string, number>();
  private readonly fullStateIntervals = new Map<string, ReturnType<typeof setInterval>>();

  // HMAC密钥管理：roomId -> { key, nonce }
  private readonly hmacKeys = new Map<string, { key: Buffer; nonce: Buffer }>();

  constructor(private readonly eventBus: EventBus) {}

  /**
   * 同步操作指令（增量同步）
   */
  async syncAction(roomId: string, action: Action): Promise<void> {
    const frameSeq = this.getNextFrameSeq(roomId);
    const timestamp = Date.now();
    const actionJson = JSON.stringify(action);
    const checksum = this.computeCRC32(actionJson);

    const syncDto: SyncActionDto = {
      roomId,
      action,
      timestamp,
      frameSeq,
      checksum,
    };

    // 广播操作指令到房间所有玩家
    this.eventBus.publishToRoom(roomId, 'sync.card.action', syncDto);

    this.logger.debug(
      `[CardSync] Action Room=${roomId} Frame=${frameSeq} Type=${action.type} Player=${action.playerId}`,
    );
  }

  /**
   * 同步完整状态（每5秒一次，用于校验）
   */
  async syncFullState(roomId: string, state: GameState): Promise<void> {
    const frameSeq = this.getNextFrameSeq(roomId);
    const timestamp = Date.now();

    // 过滤掉不可见牌区信息，只同步公开状态
    const publicState = this.filterPublicState(state);
    const stateJson = JSON.stringify(publicState);
    const checksum = this.computeCRC32(stateJson);

    const syncDto: SyncStateDto = {
      roomId,
      state: publicState,
      timestamp,
      frameSeq,
      checksum,
    };

    // 广播公开状态到房间所有玩家
    this.eventBus.publishToRoom(roomId, 'sync.card.full_state', syncDto);

    this.logger.debug(
      `[CardSync] FullState Room=${roomId} Frame=${frameSeq} Players=${state.players?.length || 0}`,
    );
  }

  /**
   * 同步不可见牌区哈希（HMAC-SHA256防作弊）
   */
  async syncHiddenCardsHash(
    roomId: string,
    playerId: string,
    cards: Card[],
  ): Promise<{ hash: string }> {
    const hmacData = this.getOrCreateHmacKey(roomId);
    const hash = this.generateCardHash(cards, hmacData.key, hmacData.nonce);
    const timestamp = Date.now();

    const hashDto: HiddenCardsHashDto = {
      roomId,
      playerId,
      hash,
      timestamp,
      nonce: hmacData.nonce.toString('base64'),
    };

    // 发送哈希给对应玩家（用于客户端校验）
    this.eventBus.publishToPlayer(playerId, 'sync.card.hidden_hash', hashDto);

    this.logger.debug(
      `[CardSync] HiddenHash Room=${roomId} Player=${playerId} Hash=${hash.substring(0, 16)}...`,
    );

    return { hash };
  }

  /**
   * 生成HMAC-SHA256哈希
   * @param cards - 牌组
   * @param key - 32字节HMAC密钥
   * @param nonce - 16字节nonce
   * @returns HMAC-SHA256哈希值的hex字符串
   */
  generateCardHash(cards: Card[], key: Buffer, nonce: Buffer): string {
    // 构建牌组数据字符串：sorted by id for determinism
    const cardsData = cards
      .slice()
      .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
      .map((c) => `${c.suit}:${c.rank}:${c.id || ''}`)
      .join('|');

    const hmac = createHmac('sha256', key);
    hmac.update(nonce);
    hmac.update(cardsData);

    return hmac.digest('hex');
  }

  /**
   * 验证牌组哈希
   */
  verifyCardHash(cards: Card[], key: Buffer, nonce: Buffer, expectedHash: string): boolean {
    const computedHash = this.generateCardHash(cards, key, nonce);
    // 使用timing-safe比较防止时序攻击
    try {
      const expectedBuf = Buffer.from(expectedHash, 'hex');
      const computedBuf = Buffer.from(computedHash, 'hex');
      return expectedBuf.length === computedBuf.length &&
        timingSafeEqual(expectedBuf, computedBuf);
    } catch {
      return false;
    }
  }

  /**
   * 启动全量状态校验定时器（每5秒一次）
   */
  startFullStateTimer(roomId: string, stateProvider: () => GameState): void {
    // 防止重复启动
    if (this.fullStateIntervals.has(roomId)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const state = stateProvider();
        if (state) {
          await this.syncFullState(roomId, state);
        }
      } catch (error) {
        this.logger.error(
          `[CardSync] FullState timer error Room=${roomId}: ${error.message}`,
        );
      }
    }, 5000); // 每5秒一次

    this.fullStateIntervals.set(roomId, interval);

    this.logger.log(`[CardSync] FullState timer started for Room=${roomId}`);
  }

  /**
   * 停止全量状态校验定时器
   */
  stopFullStateTimer(roomId: string): void {
    const interval = this.fullStateIntervals.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.fullStateIntervals.delete(roomId);
      this.logger.log(`[CardSync] FullState timer stopped for Room=${roomId}`);
    }
  }

  /**
   * 处理玩家操作
   */
  async handleAction(roomId: string, action: Action): Promise<void> {
    // 牌类游戏：发送操作指令（增量同步）
    await this.syncAction(roomId, action);
  }

  /**
   * 处理操作并同时更新状态（带状态快照）
   */
  async handleActionWithState(
    roomId: string,
    action: Action,
    newState: GameState,
  ): Promise<void> {
    // 先发送增量操作
    await this.syncAction(roomId, action);

    // 然后同步可见区的公开状态
    await this.syncVisibleCards(roomId, newState);
  }

  /**
   * 同步可见牌区（明文同步）
   */
  async syncVisibleCards(roomId: string, state: GameState): Promise<void> {
    // 提取可见牌区信息
    const visibleCards = this.extractVisibleCards(state);

    this.eventBus.publishToRoom(roomId, 'sync.card.visible_cards', {
      roomId,
      timestamp: Date.now(),
      visibleCards,
    });
  }

  /**
   * 初始化HMAC密钥（每局开始时调用）
   */
  initHmacKey(roomId: string): { key: Buffer; nonce: Buffer } {
    const key = randomBytes(32); // 32字节密钥
    const nonce = randomBytes(16); // 16字节nonce

    this.hmacKeys.set(roomId, { key, nonce });

    this.logger.log(`[CardSync] HMAC key initialized for Room=${roomId}`);

    return { key, nonce };
  }

  /**
   * 获取或创建HMAC密钥
   */
  getOrCreateHmacKey(roomId: string): { key: Buffer; nonce: Buffer } {
    let data = this.hmacKeys.get(roomId);
    if (!data) {
      data = this.initHmacKey(roomId);
    }
    return data;
  }

  /**
   * 获取HMAC密钥（用于验证）
   */
  getHmacKey(roomId: string): { key: Buffer; nonce: Buffer } | undefined {
    return this.hmacKeys.get(roomId);
  }

  /**
   * 销毁HMAC密钥（每局结束后调用）
   */
  destroyHmacKey(roomId: string): void {
    const data = this.hmacKeys.get(roomId);
    if (data) {
      // 安全清零密钥内存
      data.key.fill(0);
      data.nonce.fill(0);
      this.hmacKeys.delete(roomId);
      this.logger.log(`[CardSync] HMAC key destroyed for Room=${roomId}`);
    }
  }

  /**
   * 清理房间所有资源
   */
  cleanup(roomId: string): void {
    this.stopFullStateTimer(roomId);
    this.destroyHmacKey(roomId);
    this.frameCounters.delete(roomId);
  }

  /**
   * 过滤公开状态（移除不可见牌区信息）
   */
  private filterPublicState(state: GameState): GameState {
    const publicState: GameState = {
      ...state,
      metadata: {
        ...state.metadata,
        // 移除手牌等敏感信息，只保留公开信息
        hiddenCards: undefined,
        playerHands: undefined,
        deck: undefined,
        // 保留公开元数据
        round: state.metadata?.round,
        phase: state.metadata?.phase,
        pot: state.metadata?.pot,
        boardCards: state.metadata?.boardCards,
        discardPile: state.metadata?.discardPile,
      },
    };

    // 如果players中包含手牌信息，也需要过滤
    if (publicState.players) {
      publicState.players = publicState.players.map((p) => ({
        ...p,
        metadata: {
          ...p.metadata,
          hand: undefined,
          privateCards: undefined,
        },
      }));
    }

    return publicState;
  }

  /**
   * 提取可见牌区信息
   */
  private extractVisibleCards(state: GameState): Record<string, any> {
    return {
      boardCards: state.metadata?.boardCards || [],
      discardPile: state.metadata?.discardPile || [],
      publicCards: state.metadata?.publicCards || [],
      round: state.metadata?.round,
      phase: state.metadata?.phase,
    };
  }

  /**
   * 计算CRC32校验值
   */
  computeCRC32(data: string): string {
    const CRC32_POLYNOMIAL = 0xEDB88320;
    let crc = 0xFFFFFFFF;
    const table = this.getCRC32Table();

    for (let i = 0; i < data.length; i++) {
      const byte = data.charCodeAt(i);
      crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }

    crc = crc ^ 0xFFFFFFFF;
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
   * 获取当前帧序号
   */
  getCurrentFrameSeq(roomId: string): number {
    return this.frameCounters.get(roomId) || 0;
  }
}
