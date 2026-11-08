import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, ResourceLimits } from 'worker_threads';
import * as path from 'path';

export interface PooledWorker {
  worker: Worker;
  threadId: number;
  status: 'idle' | 'busy' | 'crashed' | 'restarting';
  assignedCategories: string[];
  restartCount: number;
  lastRestartAt: Date | null;
  createdAt: Date;
  totalTasksHandled: number;
}

export interface WorkerPoolOptions {
  initialSize?: number;
  maxSize?: number;
  maxOldGenerationSizeMb?: number;
  maxYoungGenerationSizeMb?: number;
  idleTimeoutMs?: number;
}

/**
 * WorkerPoolService - Worker 线程池管理服务
 *
 * 管理固定大小的 Worker 线程池，实现：
 * - 预创建 Worker（默认4个，最大8个）
 * - 按游戏类别智能路由（五子棋/黑白棋/围棋/象棋/麻将/斗地主/德州扑克）
 * - 崩溃自动恢复（最多3次/小时）
 * - 内存限制通过 resourceLimits 实现
 * - CPU 限制通过 resourceLimits 实现
 * - 优雅关闭与资源清理
 */
@Injectable()
export class WorkerPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerPoolService.name);
  private readonly pool: PooledWorker[] = [];
  private destroyed = false;

  // 配置参数
  private readonly initialSize: number;
  private readonly maxSize: number;
  private readonly maxOldGenerationSizeMb: number;
  private readonly maxYoungGenerationSizeMb: number;
  private readonly idleTimeoutMs: number;

  // 重启窗口限制：3次/小时
  private readonly maxRestartsPerHour = 3;
  private readonly restartWindowMs = 60 * 60 * 1000;

  // Worker 脚本路径
  private readonly workerScriptPath: string;

  constructor(options: WorkerPoolOptions = {}) {
    this.initialSize = options.initialSize ?? 4;
    this.maxSize = options.maxSize ?? 8;
    this.maxOldGenerationSizeMb = options.maxOldGenerationSizeMb ?? 256;
    this.maxYoungGenerationSizeMb = options.maxYoungGenerationSizeMb ?? 64;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30000;

    // Worker 脚本路径（编译后的 JS 文件）
    this.workerScriptPath = path.join(__dirname, 'plugin-worker.js');
  }

  async onModuleInit(): Promise<void> {
    if (this.destroyed) return;
    this.logger.log(
      `Initializing WorkerPool with ${this.initialSize} workers (max: ${this.maxSize})`,
    );
    this.initializePool();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.logger.log('Destroying WorkerPool, terminating all workers...');
    for (const pooled of this.pool) {
      try {
        pooled.worker.terminate().catch(() => {});
      } catch {
        // 忽略终止错误
      }
    }
    this.pool.length = 0;
  }

  // ==================== 池初始化与扩容 ====================

  /**
   * 初始化 Worker 池
   */
  private initializePool(): void {
    const categoryGroups = [
      ['gomoku', 'othello'],
      ['go', 'xiangqi'],
      ['mahjong', 'doudizhu'],
      ['texas_holdem'],
    ];

    for (let i = 0; i < this.initialSize; i++) {
      const categories = categoryGroups[i % categoryGroups.length];
      this.createWorker(categories);
    }

    this.logger.log(
      `WorkerPool initialized with ${this.pool.length} workers`,
    );
  }

  /**
   * 创建单个 Worker
   */
  private createWorker(categories: string[]): PooledWorker {
    const resourceLimits: ResourceLimits = {
      maxOldGenerationSizeMb: this.maxOldGenerationSizeMb,
      maxYoungGenerationSizeMb: this.maxYoungGenerationSizeMb,
    };

    const worker = new Worker(this.workerScriptPath, {
      resourceLimits,
      workerData: {
        categories,
        maxMemoryMB: this.maxOldGenerationSizeMb,
      },
    });

    const pooled: PooledWorker = {
      worker,
      threadId: worker.threadId,
      status: 'idle',
      assignedCategories: categories,
      restartCount: 0,
      lastRestartAt: null,
      createdAt: new Date(),
      totalTasksHandled: 0,
    };

    // 监听 Worker 错误
    worker.on('error', (err: Error) => {
      this.logger.error(
        `Worker #${worker.threadId} error: ${err.message}`,
        err.stack,
      );
      this.handleWorkerCrash(pooled);
    });

    // 监听 Worker 退出
    worker.on('exit', (code: number) => {
      if (code !== 0) {
        this.logger.error(
          `Worker #${worker.threadId} exited with code ${code}`,
        );
        if (pooled.status !== 'restarting') {
          this.handleWorkerCrash(pooled);
        }
      }
    });

    // 监听未捕获的异常消息
    worker.on('messageerror', (err: Error) => {
      this.logger.error(
        `Worker #${worker.threadId} message error: ${err.message}`,
      );
    });

    this.pool.push(pooled);
    this.logger.debug(
      `Created Worker #${worker.threadId} with categories [${categories.join(', ')}]`,
    );

    return pooled;
  }

  /**
   * 扩容 Worker 池
   */
  expandPool(): PooledWorker {
    if (this.pool.length >= this.maxSize) {
      throw new Error(
        `Worker pool exhausted (max: ${this.maxSize})`,
      );
    }

    const categories = this.findLeastRepresentedCategories();
    const pooled = this.createWorker(categories);
    this.logger.log(
      `WorkerPool expanded to ${this.pool.length} workers`,
    );
    return pooled;
  }

  // ==================== Worker 获取与释放 ====================

  /**
   * 获取空闲 Worker，优先按游戏类型路由
   */
  acquireWorker(gameType?: string): PooledWorker {
    if (this.destroyed) {
      throw new Error('WorkerPool has been destroyed');
    }

    // 1. 尝试找到匹配 gameType 的空闲 Worker
    if (gameType) {
      const matched = this.pool.find(
        (w) =>
          w.status === 'idle' &&
          w.assignedCategories.includes(gameType),
      );
      if (matched) {
        matched.status = 'busy';
        this.logger.debug(
          `Acquired Worker #${matched.threadId} for ${gameType} (matched)`,
        );
        return matched;
      }
    }

    // 2. 找任意空闲 Worker
    const idle = this.pool.find((w) => w.status === 'idle');
    if (idle) {
      idle.status = 'busy';
      this.logger.debug(
        `Acquired Worker #${idle.threadId} (any idle)`,
      );
      return idle;
    }

    // 3. 尝试扩容
    if (this.pool.length < this.maxSize) {
      const pooled = this.expandPool();
      pooled.status = 'busy';
      this.logger.debug(
        `Acquired newly expanded Worker #${pooled.threadId}`,
      );
      return pooled;
    }

    // 4. 池已耗尽，等待任意 Worker 变为空闲（带超时）
    throw new Error(
      `Worker pool exhausted: all ${this.maxSize} workers are busy`,
    );
  }

  /**
   * 释放 Worker 回池中
   */
  releaseWorker(pooled: PooledWorker): void {
    const found = this.pool.find((w) => w.threadId === pooled.threadId);
    if (found && found.status === 'busy') {
      found.status = 'idle';
      found.totalTasksHandled++;
      this.logger.debug(`Released Worker #${found.threadId} back to pool`);
    }
  }

  /**
   * 强制标记 Worker 为崩溃状态
   */
  markWorkerCrashed(pooled: PooledWorker): void {
    const found = this.pool.find((w) => w.threadId === pooled.threadId);
    if (found) {
      found.status = 'crashed';
      this.handleWorkerCrash(found);
    }
  }

  // ==================== 崩溃恢复 ====================

  /**
   * 处理 Worker 崩溃
   * 限制：最多3次重启/小时
   */
  private handleWorkerCrash(pooled: PooledWorker): void {
    const now = Date.now();

    // 检查重启窗口
    if (pooled.lastRestartAt) {
      const timeSinceLastRestart = now - pooled.lastRestartAt.getTime();
      if (timeSinceLastRestart > this.restartWindowMs) {
        // 超过1小时，重置计数
        pooled.restartCount = 0;
      }
    }

    if (pooled.restartCount >= this.maxRestartsPerHour) {
      this.logger.error(
        `Worker #${pooled.threadId} exceeded max restarts (${this.maxRestartsPerHour}/hour), removing from pool`,
      );
      // 从池中移除
      const index = this.pool.indexOf(pooled);
      if (index >= 0) {
        try {
          pooled.worker.terminate().catch(() => {});
        } catch {
          // 忽略
        }
        this.pool.splice(index, 1);
      }
      return;
    }

    // 重启 Worker
    pooled.status = 'restarting';
    pooled.restartCount++;
    pooled.lastRestartAt = new Date();

    this.logger.warn(
      `Restarting Worker #${pooled.threadId} (restart ${pooled.restartCount}/${this.maxRestartsPerHour})`,
    );

    // 终止旧 Worker
    try {
      pooled.worker.terminate().catch(() => {});
    } catch {
      // 忽略终止错误
    }

    // 创建新 Worker 替换
    const oldCategories = [...pooled.assignedCategories];
    const newWorker = this.createWorker(oldCategories);

    // 替换池中的旧 Worker
    const index = this.pool.indexOf(pooled);
    if (index >= 0) {
      this.pool[index] = newWorker;
    }

    this.logger.log(
      `Worker #${pooled.threadId} replaced by #${newWorker.threadId}`,
    );
  }

  // ==================== 查询方法 ====================

  /**
   * 获取池状态
   */
  getPoolStats(): {
    total: number;
    idle: number;
    busy: number;
    crashed: number;
    maxSize: number;
  } {
    return {
      total: this.pool.length,
      idle: this.pool.filter((w) => w.status === 'idle').length,
      busy: this.pool.filter((w) => w.status === 'busy').length,
      crashed: this.pool.filter((w) => w.status === 'crashed').length,
      maxSize: this.maxSize,
    };
  }

  /**
   * 获取所有 Worker 信息
   */
  getAllWorkers(): PooledWorker[] {
    return this.pool.map((w) => ({
      ...w,
      worker: undefined as any, // 不暴露 Worker 实例
    }));
  }

  /**
   * 根据 threadId 查找 PooledWorker
   */
  findByThreadId(threadId: number): PooledWorker | undefined {
    return this.pool.find((w) => w.threadId === threadId);
  }

  // ==================== 私有工具方法 ====================

  /**
   * 找到当前覆盖最少游戏类别的类别组合
   */
  private findLeastRepresentedCategories(): string[] {
    const categoryCount = new Map<string, number>();
    for (const pooled of this.pool) {
      for (const cat of pooled.assignedCategories) {
        categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1);
      }
    }

    // 所有可能的类别
    const allCategories = [
      'gomoku',
      'othello',
      'go',
      'xiangqi',
      'mahjong',
      'doudizhu',
      'texas_holdem',
    ];

    // 按覆盖次数排序
    const sorted = allCategories.sort(
      (a, b) => (categoryCount.get(a) || 0) - (categoryCount.get(b) || 0),
    );

    // 返回覆盖最少的2个类别
    return sorted.slice(0, 2);
  }
}
