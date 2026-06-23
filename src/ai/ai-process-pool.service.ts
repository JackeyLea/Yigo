import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'worker_threads';
import { join } from 'path';
import { AIProcess, ProcessHealth } from './interfaces/ai-instance.interface';

/**
 * AI进程池管理服务
 * 
 * 策略：
 * - 预创建4个AI工作进程（worker_threads）
 * - 动态扩容：当空闲进程<2时扩容至8个
 * - 动态缩容：当空闲进程>6时缩容至4个
 * - 每个进程最大思考时间10秒，超时强制终止
 * - 进程崩溃后自动重启（最多3次/小时）
 * 
 * 设计模式：对象池模式（Object Pool Pattern）
 */
@Injectable()
export class AiProcessPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiProcessPoolService.name);

  // 进程池
  private pool: Map<string, AIProcess> = new Map();
  private idleProcesses: Set<string> = new Set();
  private busyProcesses: Set<string> = new Set();

  // 等待队列 - 当没有空闲进程时，请求在此排队
  private waitQueue: Array<{
    resolve: (process: AIProcess) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    requestTime: number;
  }> = [];

  // 配置
  private readonly DEFAULT_POOL_SIZE = 4;
  private readonly MAX_POOL_SIZE = 8;
  private readonly MIN_IDLE_THRESHOLD = 2;  // 空闲<2时扩容
  private readonly MAX_IDLE_THRESHOLD = 6;  // 空闲>6时缩容
  private readonly MAX_THINK_TIME_MS = 10000; // 最大思考时间10秒
  private readonly MAX_RESTARTS_PER_HOUR = 3;
  private readonly WORKER_PATH = join(__dirname, 'ai-worker.js');

  // 重启追踪
  private restartTracker: Map<string, number[]> = new Map(); // processId -> timestamps

  // 运行时状态
  private initialized = false;
  private scaleCheckInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private shutdown = false;

  // 统计
  private stats = {
    totalTasksCompleted: 0,
    totalTasksFailed: 0,
    totalTimeouts: 0,
    totalRestarts: 0,
    peakPoolSize: 0,
    avgWaitTimeMs: 0,
    totalWaitTimeMs: 0,
    waitCount: 0,
  };

  onModuleInit(): void {
    this.initializePool(this.DEFAULT_POOL_SIZE);

    // 启动动态扩缩容检查（每30秒）
    this.scaleCheckInterval = setInterval(() => {
      this.checkAutoScaling();
    }, 30000);

    // 启动健康检查（每60秒）
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 60000);
  }

  onModuleDestroy(): void {
    this.shutdown = true;

    if (this.scaleCheckInterval) {
      clearInterval(this.scaleCheckInterval);
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // 清空等待队列
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Process pool is shutting down'));
    }
    this.waitQueue = [];

    // 终止所有进程
    for (const [processId, proc] of this.pool) {
      this.terminateWorker(proc);
    }
    this.pool.clear();
    this.idleProcesses.clear();
    this.busyProcesses.clear();
  }

  /**
   * 初始化进程池 - 预创建工作进程
   */
  initializePool(poolSize: number): void {
    if (this.initialized) {
      this.logger.warn('Process pool already initialized');
      return;
    }

    const size = Math.max(1, Math.min(poolSize, this.MAX_POOL_SIZE));
    this.logger.log(`Initializing AI process pool with ${size} workers`);

    for (let i = 0; i < size; i++) {
      this.createWorker();
    }

    this.initialized = true;
    this.stats.peakPoolSize = size;
  }

  /**
   * 获取空闲进程 - 如果没有则等待
   */
  async acquireProcess(): Promise<AIProcess> {
    if (this.shutdown) {
      throw new Error('Process pool is shutting down');
    }

    // 优先从空闲池中获取
    const idleId = this.getIdleProcessId();
    if (idleId) {
      const proc = this.pool.get(idleId);
      if (proc && proc.status === 'idle') {
        this.idleProcesses.delete(idleId);
        this.busyProcesses.add(idleId);
        proc.status = 'busy';
        proc.lastUsedAt = new Date();
        return proc;
      }
    }

    // 如果池未满，尝试创建新进程
    if (this.pool.size < this.MAX_POOL_SIZE) {
      try {
        const newProc = this.createWorker();
        this.idleProcesses.delete(newProc.processId);
        this.busyProcesses.add(newProc.processId);
        newProc.status = 'busy';
        newProc.lastUsedAt = new Date();
        return newProc;
      } catch (error) {
        this.logger.error('Failed to create new worker', error);
      }
    }

    // 等待空闲进程
    return this.waitForProcess();
  }

  /**
   * 释放进程回空闲池
   */
  releaseProcess(processId: string): void {
    const proc = this.pool.get(processId);
    if (!proc) return;

    // 检查进程是否健康
    if (proc.status === 'error') {
      this.busyProcesses.delete(processId);
      this.logger.warn(`Process ${processId} is in error state, will be restarted`);
      this.restartWorker(processId);
      return;
    }

    this.busyProcesses.delete(processId);
    this.idleProcesses.add(processId);
    proc.status = 'idle';
    proc.assignedPlugin = undefined;
    proc.assignedInstance = undefined;

    this.stats.totalTasksCompleted++;

    // 检查等待队列
    this.processWaitQueue();
  }

  /**
   * 终止指定进程
   */
  terminateProcess(processId: string): void {
    const proc = this.pool.get(processId);
    if (!proc) return;

    this.idleProcesses.delete(processId);
    this.busyProcesses.delete(processId);
    this.pool.delete(processId);

    this.terminateWorker(proc);
    this.logger.log(`Terminated process ${processId}`);
  }

  /**
   * 动态扩容/缩容
   */
  async scalePool(targetSize: number): Promise<void> {
    const clampedTarget = Math.max(1, Math.min(targetSize, this.MAX_POOL_SIZE));
    const currentSize = this.pool.size;

    if (clampedTarget > currentSize) {
      // 扩容
      const addCount = clampedTarget - currentSize;
      this.logger.log(`Scaling up: adding ${addCount} workers (current: ${currentSize}, target: ${clampedTarget})`);
      
      for (let i = 0; i < addCount; i++) {
        this.createWorker();
      }
    } else if (clampedTarget < currentSize) {
      // 缩容 - 优先移除空闲进程
      const removeCount = currentSize - clampedTarget;
      this.logger.log(`Scaling down: removing ${removeCount} workers (current: ${currentSize}, target: ${clampedTarget})`);
      
      let removed = 0;
      for (const idleId of Array.from(this.idleProcesses)) {
        if (removed >= removeCount) break;
        this.terminateProcess(idleId);
        removed++;
      }
    }

    if (this.pool.size > this.stats.peakPoolSize) {
      this.stats.peakPoolSize = this.pool.size;
    }
  }

  /**
   * 健康检查 - 返回所有进程的健康状态
   */
  async healthCheck(): Promise<ProcessHealth[]> {
    const results: ProcessHealth[] = [];

    for (const [processId, proc] of this.pool) {
      const memUsageMB = proc.memoryUsage;
      const uptimeSeconds = (Date.now() - proc.createdAt.getTime()) / 1000;

      let status: 'healthy' | 'unhealthy' = 'healthy';

      // 内存使用超过500MB认为不健康
      if (memUsageMB > 500) {
        status = 'unhealthy';
      }

      // 进程在错误状态
      if (proc.status === 'error') {
        status = 'unhealthy';
      }

      // 如果进程卡死（超过最大思考时间仍在busy状态）
      if (proc.status === 'busy' && proc.lastUsedAt) {
        const elapsed = Date.now() - proc.lastUsedAt.getTime();
        if (elapsed > this.MAX_THINK_TIME_MS * 2) {
          status = 'unhealthy';
        }
      }

      results.push({
        processId,
        status,
        memoryUsageMB: memUsageMB,
        uptimeSeconds,
        restartCount: proc.restartCount,
        lastTaskTime: proc.lastUsedAt,
      });
    }

    return results;
  }

  /**
   * 获取进程池统计信息
   */
  getStats() {
    return {
      ...this.stats,
      currentPoolSize: this.pool.size,
      idleCount: this.idleProcesses.size,
      busyCount: this.busyProcesses.size,
      waitQueueLength: this.waitQueue.length,
    };
  }

  // ==================== 私有方法 ====================

  /**
   * 创建新的Worker进程
   */
  private createWorker(): AIProcess {
    const processId = `ai-worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      // 使用worker_threads创建Worker
      const workerPath = join(__dirname, 'ai-worker.js');
      const worker = new Worker(workerPath);

      const proc: AIProcess = {
        processId,
        worker,
        status: 'idle',
        memoryUsage: 0,
        cpuUsage: 0,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        restartCount: 0,
        totalTasks: 0,
      };

      // 监听Worker消息
      worker.on('message', (message) => {
        if (message.type === 'heartbeat' && message.memoryUsage) {
          proc.memoryUsage = message.memoryUsage;
        }
      });

      // 监听Worker错误
      worker.on('error', (error) => {
        this.logger.error(`Worker ${processId} error:`, error);
        proc.status = 'error';
        this.stats.totalTasksFailed++;
      });

      // 监听Worker退出
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.logger.error(`Worker ${processId} exited with code ${code}`);
          proc.status = 'error';

          // 如果进程池仍在运行，自动重启（如果未超过重启限制）
          if (!this.shutdown) {
            this.handleWorkerCrash(processId);
          }
        }
      });

      this.pool.set(processId, proc);
      this.idleProcesses.add(processId);

      return proc;
    } catch (error) {
      this.logger.error(`Failed to create worker ${processId}:`, error);
      throw error;
    }
  }

  /**
   * 终止Worker
   */
  private terminateWorker(proc: AIProcess): void {
    try {
      proc.worker.terminate();
    } catch {
      // 忽略终止错误
    }
  }

  /**
   * 重启Worker
   */
  private restartWorker(processId: string): void {
    // 检查重启限制
    const now = Date.now();
    const restarts = this.restartTracker.get(processId) || [];
    const recentRestarts = restarts.filter(t => now - t < 3600000); // 最近1小时

    if (recentRestarts.length >= this.MAX_RESTARTS_PER_HOUR) {
      this.logger.error(`Worker ${processId} exceeded max restarts (${this.MAX_RESTARTS_PER_HOUR}/hour)`);
      this.pool.delete(processId);
      return;
    }

    // 记录重启时间
    recentRestarts.push(now);
    this.restartTracker.set(processId, recentRestarts);

    // 终止旧Worker
    const oldProc = this.pool.get(processId);
    if (oldProc) {
      this.terminateWorker(oldProc);
    }

    this.pool.delete(processId);
    this.idleProcesses.delete(processId);
    this.busyProcesses.delete(processId);

    // 创建新Worker
    const newProc = this.createWorker();
    newProc.restartCount = recentRestarts.length;
    this.stats.totalRestarts++;

    this.logger.log(`Restarted worker ${processId} -> ${newProc.processId} (restart #${newProc.restartCount})`);
  }

  /**
   * 处理Worker崩溃
   */
  private handleWorkerCrash(processId: string): void {
    this.logger.warn(`Handling crash for worker ${processId}`);
    this.stats.totalTasksFailed++;
    this.restartWorker(processId);
  }

  /**
   * 获取一个空闲进程ID
   */
  private getIdleProcessId(): string | undefined {
    // 选择使用最少（totalTasks最小）的空闲进程
    let bestId: string | undefined;
    let minTasks = Infinity;

    for (const id of this.idleProcesses) {
      const proc = this.pool.get(id);
      if (proc && proc.status === 'idle' && proc.totalTasks < minTasks) {
        minTasks = proc.totalTasks;
        bestId = id;
      }
    }

    return bestId;
  }

  /**
   * 等待空闲进程
   */
  private waitForProcess(): Promise<AIProcess> {
    return new Promise((resolve, reject) => {
      const waitStart = Date.now();

      const timeout = setTimeout(() => {
        // 从等待队列中移除
        const idx = this.waitQueue.findIndex(w => w.resolve === resolve);
        if (idx !== -1) {
          this.waitQueue.splice(idx, 1);
        }
        this.stats.totalTimeouts++;
        reject(new Error('Timeout waiting for available AI process'));
      }, this.MAX_THINK_TIME_MS);

      const waiter = {
        resolve: (proc: AIProcess) => {
          clearTimeout(timeout);
          const waitTime = Date.now() - waitStart;
          this.stats.totalWaitTimeMs += waitTime;
          this.stats.waitCount++;
          this.stats.avgWaitTimeMs = this.stats.waitCount > 0 
            ? this.stats.totalWaitTimeMs / this.stats.waitCount 
            : 0;
          resolve(proc);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout,
        requestTime: waitStart,
      };

      this.waitQueue.push(waiter);
    });
  }

  /**
   * 处理等待队列
   */
  private processWaitQueue(): void {
    while (this.waitQueue.length > 0) {
      const idleId = this.getIdleProcessId();
      if (!idleId) break;

      const waiter = this.waitQueue.shift()!;
      const proc = this.pool.get(idleId);

      if (proc && proc.status === 'idle') {
        this.idleProcesses.delete(idleId);
        this.busyProcesses.add(idleId);
        proc.status = 'busy';
        proc.lastUsedAt = new Date();
        waiter.resolve(proc);
      } else {
        // 进程不可用，放回队列
        this.waitQueue.unshift(waiter);
        break;
      }
    }
  }

  /**
   * 自动扩缩容检查
   */
  private checkAutoScaling(): void {
    if (this.shutdown) return;

    const idleCount = this.idleProcesses.size;
    const totalCount = this.pool.size;

    // 扩容检查
    if (idleCount < this.MIN_IDLE_THRESHOLD && totalCount < this.MAX_POOL_SIZE) {
      this.logger.log(`Auto-scaling up: idle=${idleCount}, total=${totalCount}`);
      const newSize = Math.min(this.MAX_POOL_SIZE, totalCount + 2);
      this.scalePool(newSize);
    }

    // 缩容检查
    if (idleCount > this.MAX_IDLE_THRESHOLD && totalCount > this.DEFAULT_POOL_SIZE) {
      this.logger.log(`Auto-scaling down: idle=${idleCount}, total=${totalCount}`);
      const newSize = Math.max(this.DEFAULT_POOL_SIZE, totalCount - 2);
      this.scalePool(newSize);
    }
  }

  /**
   * 定期健康检查
   */
  private async performHealthCheck(): Promise<void> {
    if (this.shutdown) return;

    const health = await this.healthCheck();
    const unhealthy = health.filter(h => h.status === 'unhealthy');

    if (unhealthy.length > 0) {
      this.logger.warn(`${unhealthy.length} unhealthy workers found`);
      for (const h of unhealthy) {
        this.restartWorker(h.processId);
      }
    }
  }
}
