/**
 * EscrowService - 断线托管服务
 *
 * 当玩家断线时，自动启动AI代打功能。
 * 功能包括：
 * - 启动/取消托管
 * - AI代理操作
 * - 托管超时自动判负
 * - 托管状态Redis存储
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EventBus } from '../../plugin/event-bus';
import { AiEngineService } from '../../ai/ai-engine.service';
import { GameState, Action } from '../../plugin/interfaces/game-controller.interface';

/** 托管状态接口 */
export interface EscrowStatus {
  roomId: string;
  playerId: string;
  startTime: number;
  aiInstanceId: string | null;
  timeoutSeconds: number;
}

/** 托管操作结果 */
export interface EscrowActionResult {
  action: Action;
  isEscrowed: boolean;
  instanceId?: string;
}

/** Redis键前缀 */
const REDIS_KEY = {
  ESCROW_STATUS: (roomId: string, playerId: string) => `escrow:${roomId}:${playerId}`,
  ESCROW_TIMEOUT: (roomId: string, playerId: string) => `escrow:timeout:${roomId}:${playerId}`,
  ESCROW_LOCK: (roomId: string) => `escrow:lock:${roomId}`,
};

/** 默认托管超时时间（秒） */
const DEFAULT_ESCROW_TIMEOUT_SECONDS = 60;

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);
  private readonly redis: Redis;
  private readonly timeoutSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
    private readonly aiEngineService: AiEngineService,
  ) {
    // 初始化Redis连接
    const redisConfig = this.configService.get('redis');
    this.redis = new Redis({
      host: redisConfig?.host || 'localhost',
      port: redisConfig?.port || 6379,
      password: redisConfig?.password || undefined,
      db: redisConfig?.db || 0,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error:', err.message);
    });

    this.timeoutSeconds = this.configService.get<number>(
      'ESCROW_TIMEOUT_SECONDS',
      DEFAULT_ESCROW_TIMEOUT_SECONDS,
    );
  }

  // ==================== 核心托管方法 ====================

  /**
   * 启动托管
   * - 玩家断线时调用
   * - 创建AI实例
   * - 设置托管超时
   */
  async startEscrow(roomId: string, playerId: string): Promise<void> {
    const redisKey = REDIS_KEY.ESCROW_STATUS(roomId, playerId);

    // 检查是否已处于托管状态
    const existing = await this.redis.exists(redisKey);
    if (existing) {
      this.logger.warn(`Escrow already active for player ${playerId} in room ${roomId}`);
      throw new ConflictException('托管已处于激活状态');
    }

    try {
      // 创建AI实例用于托管代打
      const aiInstance = await this.aiEngineService.createAI(
        'chess', // 默认使用chess插件，实际应根据房间游戏类型
        'medium', // 托管AI使用中等难度
        { isEscrow: true },
      );

      const now = Date.now();
      const status: EscrowStatus = {
        roomId,
        playerId,
        startTime: now,
        aiInstanceId: aiInstance.instanceId,
        timeoutSeconds: this.timeoutSeconds,
      };

      // 存储托管状态到Redis（TTL = 超时时间 + 30秒缓冲）
      await this.redis.setex(
        redisKey,
        this.timeoutSeconds + 30,
        JSON.stringify(status),
      );

      // 启动托管超时计时
      this.startEscrowTimeout(roomId, playerId);

      // 广播托管启动事件
      this.eventBus.publishToRoom(roomId, 'escrow.started', {
        roomId,
        playerId,
        startTime: now,
        timeoutSeconds: this.timeoutSeconds,
      });

      this.logger.log(`Escrow started for player ${playerId} in room ${roomId}, AI instance: ${aiInstance.instanceId}`);
    } catch (error) {
      this.logger.error(`Failed to start escrow for player ${playerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 取消托管（玩家重连后）
   * - 释放AI实例
   * - 清除托管状态
   */
  async cancelEscrow(roomId: string, playerId: string): Promise<void> {
    const redisKey = REDIS_KEY.ESCROW_STATUS(roomId, playerId);

    const statusRaw = await this.redis.get(redisKey);
    if (!statusRaw) {
      this.logger.warn(`No active escrow found for player ${playerId} in room ${roomId}`);
      return;
    }

    const status: EscrowStatus = JSON.parse(statusRaw);

    try {
      // 释放AI实例
      if (status.aiInstanceId) {
        await this.aiEngineService.releaseAI(status.aiInstanceId);
      }

      // 清除托管状态
      await this.redis.del(redisKey);
      await this.redis.del(REDIS_KEY.ESCROW_TIMEOUT(roomId, playerId));

      // 广播托管取消事件
      this.eventBus.publishToRoom(roomId, 'escrow.cancelled', {
        roomId,
        playerId,
        cancelledAt: Date.now(),
      });

      this.logger.log(`Escrow cancelled for player ${playerId} in room ${roomId}`);
    } catch (error) {
      this.logger.error(`Failed to cancel escrow for player ${playerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查是否处于托管状态
   */
  async isEscrowed(roomId: string, playerId: string): Promise<boolean> {
    const redisKey = REDIS_KEY.ESCROW_STATUS(roomId, playerId);
    const exists = await this.redis.exists(redisKey);
    return exists === 1;
  }

  /**
   * 批量检查房间内所有托管状态
   */
  async getRoomEscrowStatuses(roomId: string): Promise<EscrowStatus[]> {
    const pattern = REDIS_KEY.ESCROW_STATUS(roomId, '*');
    const keys = await this.redis.keys(pattern);

    if (keys.length === 0) return [];

    const values = await this.redis.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as EscrowStatus);
  }

  /**
   * 获取托管AI的操作
   * - 使用AI引擎请求决策
   * - 返回AI选择的动作
   */
  async getEscrowAction(
    roomId: string,
    playerId: string,
    gameState: GameState,
  ): Promise<EscrowActionResult> {
    const redisKey = REDIS_KEY.ESCROW_STATUS(roomId, playerId);

    const statusRaw = await this.redis.get(redisKey);
    if (!statusRaw) {
      return { action: null as any, isEscrowed: false };
    }

    const status: EscrowStatus = JSON.parse(statusRaw);

    if (!status.aiInstanceId) {
      return { action: null as any, isEscrowed: true };
    }

    try {
      // 获取合法动作列表（从游戏状态推导）
      const legalActions = this.extractLegalActions(gameState, playerId);

      if (legalActions.length === 0) {
        throw new NotFoundException('没有可用的合法动作');
      }

      // 请求AI决策
      const action = await this.aiEngineService.requestAction(
        status.aiInstanceId,
        playerId,
        gameState,
        legalActions,
        5000, // 托管AI决策超时5秒
      );

      this.logger.debug(`Escrow AI action for player ${playerId}: ${JSON.stringify(action)}`);

      return {
        action,
        isEscrowed: true,
        instanceId: status.aiInstanceId,
      };
    } catch (error) {
      this.logger.error(`Escrow AI action failed for player ${playerId}: ${error.message}`);
      // 失败时返回随机合法动作
      const legalActions = this.extractLegalActions(gameState, playerId);
      return {
        action: legalActions[Math.floor(Math.random() * legalActions.length)],
        isEscrowed: true,
        instanceId: status.aiInstanceId,
      };
    }
  }

  /**
   * 玩家重连后处理
   * - 取消托管
   * - 通知玩家选择继续或认输
   */
  async handlePlayerReconnect(
    roomId: string,
    playerId: string,
  ): Promise<{ canContinue: boolean; escrowDuration: number }> {
    const redisKey = REDIS_KEY.ESCROW_STATUS(roomId, playerId);
    const statusRaw = await this.redis.get(redisKey);

    if (!statusRaw) {
      return { canContinue: false, escrowDuration: 0 };
    }

    const status: EscrowStatus = JSON.parse(statusRaw);
    const escrowDuration = Math.floor((Date.now() - status.startTime) / 1000);

    // 取消托管
    await this.cancelEscrow(roomId, playerId);

    // 广播玩家重连事件
    this.eventBus.publishToRoom(roomId, 'player.reconnected', {
      roomId,
      playerId,
      escrowDuration,
      timestamp: Date.now(),
    });

    return {
      canContinue: true,
      escrowDuration,
    };
  }

  /**
   * 托管认输
   * - 主动结束托管并判负
   */
  async escrowResign(roomId: string, playerId: string): Promise<void> {
    const redisKey = REDIS_KEY.ESCROW_STATUS(roomId, playerId);
    const statusRaw = await this.redis.get(redisKey);

    if (statusRaw) {
      const status: EscrowStatus = JSON.parse(statusRaw);

      // 释放AI实例
      if (status.aiInstanceId) {
        await this.aiEngineService.releaseAI(status.aiInstanceId);
      }

      // 清除托管状态
      await this.redis.del(redisKey);
      await this.redis.del(REDIS_KEY.ESCROW_TIMEOUT(roomId, playerId));
    }

    // 广播托管认输事件
    this.eventBus.publishToRoom(roomId, 'escrow.resigned', {
      roomId,
      playerId,
      reason: '托管超时自动认输',
      timestamp: Date.now(),
    });

    this.logger.log(`Escrow resign for player ${playerId} in room ${roomId}`);
  }

  // ==================== 私有方法 ====================

  /**
   * 启动托管超时计时
   * - 超过配置时间后自动判负
   */
  private startEscrowTimeout(roomId: string, playerId: string): void {
    const timeoutKey = REDIS_KEY.ESCROW_TIMEOUT(roomId, playerId);

    // 使用Redis设置超时标记
    this.redis.setex(timeoutKey, this.timeoutSeconds, '1')
      .then(() => {
        this.logger.debug(`Escrow timeout timer started for player ${playerId}: ${this.timeoutSeconds}s`);
      })
      .catch((err) => {
        this.logger.error(`Failed to set escrow timeout: ${err.message}`);
      });

    // 实际超时处理由定时任务或外部触发器完成
    // 这里设置一个本地定时器作为备份
    setTimeout(async () => {
      try {
        const stillEscrowed = await this.isEscrowed(roomId, playerId);
        if (stillEscrowed) {
          this.logger.warn(`Escrow timeout expired for player ${playerId} in room ${roomId}, auto resign`);
          await this.escrowResign(roomId, playerId);
        }
      } catch (error) {
        this.logger.error(`Escrow timeout handler error: ${error.message}`);
      }
    }, this.timeoutSeconds * 1000);
  }

  /**
   * 从游戏状态中提取合法动作
   * 具体的动作提取逻辑应由游戏插件实现
   */
  private extractLegalActions(gameState: GameState, playerId: string): Action[] {
    // 默认实现：返回游戏状态中包含的合法动作
    if (gameState && (gameState as any).legalActions) {
      return (gameState as any).legalActions as Action[];
    }

    // 如果没有预计算合法动作，返回空数组
    // 实际项目中应该调用游戏插件的getLegalActions方法
    this.logger.warn(`No legal actions found in gameState for player ${playerId}`);
    return [];
  }

  /**
   * 服务销毁时清理
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('EscrowService destroyed');
  }
}
