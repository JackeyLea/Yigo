import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

import { MatchQueueService } from './match-queue.service';
import { MatchEngineService } from './match-engine.service';

/**
 * MatchCleanupService - 匹配清理服务
 *
 * 定时任务：
 * - 每分钟运行一次
 * - 清理超时（60秒）的匹配票
 * - 为超时的单人匹配填充AI
 * - 清理已取消的匹配票
 */
@Injectable()
export class MatchCleanupService {
  private readonly logger = new Logger(MatchCleanupService.name);
  private readonly redis: Redis;

  // 定时任务锁的TTL（秒）
  private readonly LOCK_TTL_SECONDS = 55;
  // 批量处理大小
  private readonly BATCH_SIZE = 100;

  constructor(
    private readonly configService: ConfigService,
    private readonly matchQueue: MatchQueueService,
    private readonly matchEngine: MatchEngineService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
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
  }

  /**
   * 每分钟执行一次匹配清理
   * 使用分布式锁确保只有一个实例执行
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCleanup(): Promise<void> {
    const lockKey = 'match:cleanup:lock';
    const lockValue = Date.now().toString();

    try {
      // 尝试获取分布式锁（SET NX EX）
      const acquired = await this.redis.set(
        lockKey,
        lockValue,
        'NX',
        'EX',
        this.LOCK_TTL_SECONDS,
      );

      if (!acquired) {
        this.logger.debug('Cleanup lock not acquired, skipping this run');
        return;
      }

      this.logger.debug('Starting match cleanup job');
      const startTime = Date.now();

      // 1. 获取所有有排队玩家的游戏插件
      const pluginIds = await this.getActivePluginIds();

      // 2. 对每个插件处理超时
      for (const pluginId of pluginIds) {
        try {
          // 处理超时的匹配票
          await this.matchQueue.handleTimeouts(pluginId);

          // 清理过期/无效的票
          const removed = await this.matchQueue.removeExpiredTickets(pluginId);
          if (removed > 0) {
            this.logger.debug(`Removed ${removed} expired tickets for ${pluginId}`);
          }
        } catch (error) {
          this.logger.error(`Error processing timeouts for ${pluginId}: ${error.message}`);
        }
      }

      // 3. 清理已取消的匹配票
      await this.matchQueue.cleanupCancelledTickets();

      // 4. 清理孤立的状态Key
      await this.cleanupOrphanStatusKeys();

      const elapsed = Date.now() - startTime;
      this.logger.log(`Match cleanup completed in ${elapsed}ms, processed ${pluginIds.length} plugins`);
    } catch (error) {
      this.logger.error(`Cleanup job error: ${error.message}`);
    } finally {
      // 释放锁（使用Lua脚本确保原子性）
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await this.redis.eval(luaScript, 1, lockKey, lockValue);
      } catch {
        // 锁可能已过期，忽略错误
      }
    }
  }

  /**
   * 获取所有有活跃队列的游戏插件ID
   * @returns 插件ID列表
   */
  private async getActivePluginIds(): Promise<string[]> {
    // 扫描所有匹配队列Key
    const pluginIds = new Set<string>();

    try {
      const stream = this.redis.scanStream({
        match: 'match:queue:*',
        count: 100,
      });

      return new Promise((resolve, reject) => {
        stream.on('data', (keys: string[]) => {
          for (const key of keys) {
            // 从 key 中提取 pluginId: match:queue:{pluginId}
            const pluginId = key.replace('match:queue:', '');
            if (pluginId) {
              pluginIds.add(pluginId);
            }
          }
        });

        stream.on('end', () => {
          resolve(Array.from(pluginIds));
        });

        stream.on('error', (err) => {
          reject(err);
        });
      });
    } catch (error) {
      this.logger.error(`Failed to scan plugin IDs: ${error.message}`);
      return [];
    }
  }

  /**
   * 清理孤立的状态Key（没有对应ticket的状态）
   */
  private async cleanupOrphanStatusKeys(): Promise<void> {
    const cleanedKeys: string[] = [];

    try {
      const stream = this.redis.scanStream({
        match: 'match:status:*',
        count: this.BATCH_SIZE,
      });

      stream.on('data', async (keys: string[]) => {
        for (const key of keys) {
          const ticketId = key.replace('match:status:', '');
          const ticketExists = await this.redis.exists(`match:ticket:${ticketId}`);
          if (!ticketExists) {
            cleanedKeys.push(key);
          }
        }
      });

      stream.on('end', async () => {
        if (cleanedKeys.length > 0) {
          const pipeline = this.redis.pipeline();
          for (const key of cleanedKeys) {
            pipeline.del(key);
          }
          await pipeline.exec();
          this.logger.debug(`Cleaned ${cleanedKeys.length} orphan status keys`);
        }
      });
    } catch (error) {
      this.logger.error(`Failed to cleanup orphan status keys: ${error.message}`);
    }
  }

  /**
   * 手动触发清理（用于测试或管理接口）
   * @param pluginId 可选：指定游戏插件ID
   */
  async runManualCleanup(pluginId?: string): Promise<{
    processed: number;
    timeoutsHandled: number;
    expiredRemoved: number;
  }> {
    const result = {
      processed: 0,
      timeoutsHandled: 0,
      expiredRemoved: 0,
    };

    if (pluginId) {
      // 处理指定插件
      const removed = await this.matchQueue.removeExpiredTickets(pluginId);
      result.expiredRemoved = removed;
      result.processed = 1;
    } else {
      // 处理所有插件
      const pluginIds = await this.getActivePluginIds();
      for (const pid of pluginIds) {
        try {
          await this.matchQueue.handleTimeouts(pid);
          result.timeoutsHandled++;

          const removed = await this.matchQueue.removeExpiredTickets(pid);
          result.expiredRemoved += removed;
        } catch (error) {
          this.logger.error(`Error in manual cleanup for ${pid}: ${error.message}`);
        }
      }
      result.processed = pluginIds.length;
    }

    // 清理已取消的票
    await this.matchQueue.cleanupCancelledTickets();

    // 清理孤立状态
    await this.cleanupOrphanStatusKeys();

    this.logger.log(`Manual cleanup completed: ${JSON.stringify(result)}`);
    return result;
  }
}
