import {
  Injectable,
  Logger,
  OnModuleDestroy,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Worker, MessageChannel, MessagePort } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { PluginMeta } from './interfaces/plugin-meta.interface';
import { EventBus } from './event-bus';
import {
  GameController,
  GameState,
  Action,
  PlayerState,
} from './interfaces/game-controller.interface';
import { AIController } from './interfaces/ai-controller.interface';
import {
  FrameworkContext,
  Logger as FrameworkLogger,
} from './interfaces/framework-context.interface';
import { WorkerPoolService, PooledWorker } from './worker-pool.service';

// ============================================================
// PluginSandbox - 基于 worker_threads 的插件沙箱隔离系统
// ============================================================
// 架构：主线程 (NestJS) → WorkerPool → Worker 线程 → vm 二次隔离
// 第一层：Worker 线程（进程级隔离）
// 第二层：vm.Context（代码级隔离）
// 通信：MessageChannel（主线程 ↔ Worker）
// ============================================================

export interface PluginInstance {
  pluginId: string;
  meta: PluginMeta;
  worker: Worker;
  port: MessagePort;
  pooledWorker: PooledWorker;
  status: 'loaded' | 'running' | 'error' | 'degraded';
  loadedAt: Date;
  memoryUsageMB: number;
  restartCount: number;
  lastRestartAt: Date | null;
  gameControllerCreated: boolean;
  aiControllerCreated: boolean;
}

interface SandboxMemory {
  lastCheck: number;
  peakMB: number;
  violations: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * PluginSandbox - 基于 Worker 线程的插件沙箱
 *
 * 使用 Node.js worker_threads 实现真正的进程级隔离：
 * - 进程隔离：插件在独立 Worker 线程中运行，崩溃不影响主进程
 * - 双重沙箱：Worker 内使用 vm 模块做二次隔离
 * - 内存限制：通过 resourceLimits + 定期检查实现
 * - CPU 限制：通过 resourceLimits 实现
 * - 自动重启：Worker 崩溃时自动重启（最多3次/小时）
 * - 超时控制：10秒执行超时（MessageChannel 实现）
 * - 路由优化：按游戏类型智能路由到对应 Worker
 */
@Injectable()
export class PluginSandbox implements OnModuleDestroy {
  private readonly logger = new Logger(PluginSandbox.name);
  private readonly instances = new Map<string, PluginInstance>();
  private readonly memoryStats = new Map<string, SandboxMemory>();
  private readonly memoryCheckIntervalMs = 5000;
  private readonly memoryViolationThreshold = 3;
  private memoryCheckTimer?: ReturnType<typeof setInterval>;
  private destroyed = false;

  // 请求等待映射（用于 MessagePort 异步响应）
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private requestCounter = 0;

  // Worker 消息处理器映射
  private readonly workerMessageHandlers = new Map<number, (msg: any) => void>();
  private readonly workerErrorHandlers = new Map<number, (err: Error) => void>();

  constructor(private readonly workerPool: WorkerPoolService) {
    this.startMemoryMonitoring();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
    }

    // 清理所有 pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('PluginSandbox destroyed'));
    }
    this.pendingRequests.clear();

    // 卸载所有插件
    for (const [pluginId] of this.instances) {
      this.unload(pluginId).catch((err) => {
        this.logger.error(`Error unloading plugin ${pluginId}: ${err.message}`);
      });
    }
    this.instances.clear();
    this.memoryStats.clear();
  }

  // ==================== 核心生命周期方法 ====================

  /**
   * 加载插件到沙箱中
   * 流程：获取 Worker → 创建 MessageChannel → 发送 LOAD_PLUGIN → 等待确认
   */
  async load(pluginPath: string, meta: PluginMeta): Promise<PluginInstance> {
    if (this.destroyed) {
      throw new InternalServerErrorException('PluginSandbox has been destroyed');
    }

    if (this.instances.has(meta.pluginId)) {
      throw new BadRequestException(
        `Plugin ${meta.pluginId} is already loaded`,
      );
    }

    const resolvedPath = path.resolve(pluginPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new BadRequestException(
        `Plugin file not found: ${resolvedPath}`,
      );
    }

    try {
      // 1. 从池中获取空闲 Worker（按游戏类型路由）
      const pooledWorker = this.workerPool.acquireWorker(meta.gameType);
      const worker = pooledWorker.worker;

      // 2. 创建 MessageChannel 用于双向通信
      const { port1, port2 } = new MessageChannel();

      // 3. 设置消息监听
      this.setupPortListener(port1, meta.pluginId);
      this.setupWorkerErrorHandler(pooledWorker, meta);

      // 4. 发送加载指令到 Worker
      await this.sendWorkerMessage(worker, {
        type: 'LOAD_PLUGIN',
        pluginPath: resolvedPath,
        meta,
        requestId: this.generateRequestId(),
      }, port2);

      // 5. 等待 Worker 确认加载完成（10秒超时）
      const result = await this.waitForResponse(port1, 10000);

      if (!result.success) {
        this.workerPool.releaseWorker(pooledWorker);
        throw new InternalServerErrorException(
          `Worker failed to load plugin: ${result.error}`,
        );
      }

      // 6. 创建实例
      const instance: PluginInstance = {
        pluginId: meta.pluginId,
        meta,
        worker,
        port: port1,
        pooledWorker,
        status: 'loaded',
        loadedAt: new Date(),
        memoryUsageMB: 0,
        restartCount: 0,
        lastRestartAt: null,
        gameControllerCreated: false,
        aiControllerCreated: false,
      };

      this.instances.set(meta.pluginId, instance);
      this.memoryStats.set(meta.pluginId, {
        lastCheck: Date.now(),
        peakMB: 0,
        violations: 0,
      });

      this.logger.log(
        `Plugin "${meta.name}" (${meta.pluginId}) loaded into Worker #${worker.threadId}`,
      );
      return instance;
    } catch (err: any) {
      this.logger.error(
        `Failed to load plugin "${meta.pluginId}": ${err?.message || err}`,
      );
      throw new InternalServerErrorException(
        `Failed to load plugin: ${err?.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * 卸载插件
   * 流程：发送 UNLOAD 消息 → 等待清理 → 终止 Worker → 释放回池
   */
  async unload(pluginId: string): Promise<void> {
    const instance = this.instances.get(pluginId);
    if (!instance) {
      this.logger.warn(`Plugin ${pluginId} not found for unload`);
      return;
    }

    try {
      // 1. 通知插件进行清理（通过 Worker）
      try {
        await this.sendPortMessage(instance.port, {
          type: 'UNLOAD_PLUGIN',
          pluginId,
          requestId: this.generateRequestId(),
        }, 5000);
      } catch (err: any) {
        this.logger.warn(`Plugin ${pluginId} unload message error: ${err?.message}`);
      }

      // 2. 等待一小段时间让 Worker 清理
      await this.delay(50);

      // 3. 关闭 MessagePort
      try {
        instance.port.close();
      } catch {
        // 忽略关闭错误
      }

      // 4. 清理 Worker 错误处理器
      this.cleanupWorkerHandlers(instance.pooledWorker.threadId);

      // 5. 释放 Worker 回池中
      this.workerPool.releaseWorker(instance.pooledWorker);

      this.instances.delete(pluginId);
      this.memoryStats.delete(pluginId);

      this.logger.log(`Plugin ${pluginId} unloaded from sandbox`);
    } catch (err: any) {
      this.logger.error(`Error unloading plugin ${pluginId}: ${err?.message}`);
      throw err;
    }
  }

  /**
   * 获取插件实例
   */
  getInstance(pluginId: string): PluginInstance | undefined {
    return this.instances.get(pluginId);
  }

  /**
   * 获取插件状态
   */
  getStatus(pluginId: string): 'loaded' | 'running' | 'error' | 'degraded' {
    const instance = this.instances.get(pluginId);
    return instance?.status ?? 'error';
  }

  /**
   * 设置插件状态
   */
  setStatus(
    pluginId: string,
    status: 'loaded' | 'running' | 'error' | 'degraded',
  ): void {
    const instance = this.instances.get(pluginId);
    if (instance) {
      instance.status = status;
    }
  }

  /**
   * 获取所有已加载的插件实例
   */
  getAllInstances(): PluginInstance[] {
    return Array.from(this.instances.values());
  }

  // ==================== 游戏控制器工厂 ====================

  /**
   * 创建游戏控制器
   * 通过 Worker 消息在沙箱内实例化
   */
  async createGameController(
    pluginId: string,
    roomConfig: { roomId: string; gameMode: string; playerIds: string[]; config?: Record<string, any> },
  ): Promise<GameController> {
    const instance = this.instances.get(pluginId);
    if (!instance) {
      throw new BadRequestException(`Plugin "${pluginId}" is not loaded`);
    }

    // 确保插件已启动
    if (instance.status !== 'running' && instance.status !== 'loaded') {
      throw new BadRequestException(
        `Plugin "${pluginId}" is in ${instance.status} state`,
      );
    }

    // 通过 Worker 创建游戏控制器
    const result = await this.sendPortMessage(instance.port, {
      type: 'CREATE_GAME_CONTROLLER',
      pluginId,
      roomConfig,
      requestId: this.generateRequestId(),
    }, 10000);

    if (!result.success) {
      throw new InternalServerErrorException(
        `Failed to create GameController: ${result.error}`,
      );
    }

    instance.gameControllerCreated = true;
    if (instance.status === 'loaded') {
      instance.status = 'running';
    }

    // 返回一个代理对象，所有方法调用都通过 MessagePort 转发
    return this.createGameControllerProxy(pluginId);
  }

  /**
   * 创建 AI 控制器
   */
  async createAIController(
    pluginId: string,
    difficulty: string,
  ): Promise<AIController> {
    const instance = this.instances.get(pluginId);
    if (!instance) {
      throw new BadRequestException(`Plugin "${pluginId}" is not loaded`);
    }

    const result = await this.sendPortMessage(instance.port, {
      type: 'CREATE_AI_CONTROLLER',
      pluginId,
      difficulty,
      requestId: this.generateRequestId(),
    }, 10000);

    if (!result.success) {
      throw new InternalServerErrorException(
        `Failed to create AIController: ${result.error}`,
      );
    }

    instance.aiControllerCreated = true;

    // 返回代理对象
    return this.createAIControllerProxy(pluginId);
  }

  // ==================== 框架上下文 ====================

  /**
   * 创建框架上下文（供插件使用）
   */
  createFrameworkContext(
    pluginId: string,
    roomId: string,
    config: Record<string, any>,
    eventBus: EventBus,
  ): FrameworkContext {
    const logger: FrameworkLogger = {
      debug: (msg: string, ...args: any[]) =>
        this.logger.debug(`[${pluginId}] ${msg}`, ...args),
      info: (msg: string, ...args: any[]) =>
        this.logger.log(`[${pluginId}] ${msg}`, ...args),
      warn: (msg: string, ...args: any[]) =>
        this.logger.warn(`[${pluginId}] ${msg}`, ...args),
      error: (msg: string, ...args: any[]) =>
        this.logger.error(`[${pluginId}] ${msg}`, ...args),
    };

    const localize = (key: string, params?: Record<string, string>): string => {
      let text = key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
        }
      }
      return text;
    };

    return {
      pluginId,
      roomId,
      config,
      eventBus,
      logger,
      localize,
    };
  }

  // ==================== 代理工厂 ====================

  /**
   * 创建 GameController 代理
   * 所有方法调用通过 MessagePort 转发到 Worker 内的实际实例
   */
  private createGameControllerProxy(pluginId: string): GameController {
    return {
      start: async (): Promise<void> => {
        await this.sendGameAction(pluginId, { type: 'start', playerId: '', data: {}, timestamp: Date.now() });
      },
      getCurrentState: (): GameState => {
        // 同步方法无法直接支持，需要改为异步
        // 返回一个占位状态，实际使用应通过异步 API
        throw new Error('getCurrentState() is async in worker sandbox. Use sendGameAction() instead.');
      },
      getActivePlayer: (): string => {
        throw new Error('getActivePlayer() is async in worker sandbox. Use sendGameAction() instead.');
      },
      submitAction: (playerId: string, action: Action): void => {
        this.sendGameAction(pluginId, {
          type: 'submitAction',
          playerId,
          data: { playerId, actionType: action.type, actionData: action.data },
          timestamp: Date.now(),
        }).catch((err) => {
          this.logger.error(`submitAction error: ${err.message}`);
        });
      },
      getLegalActions: (playerId: string): Action[] => {
        throw new Error('getLegalActions() is async in worker sandbox. Use sendGameAction() instead.');
      },
      endGame: (): void => {
        this.sendGameAction(pluginId, { type: 'endGame', playerId: '', data: {}, timestamp: Date.now() })
          .catch((err) => {
            this.logger.error(`endGame error: ${err.message}`);
          });
      },
    };
  }

  /**
   * 创建 AIController 代理
   */
  private createAIControllerProxy(pluginId: string): AIController {
    return {
      requestAction: (
        playerId: string,
        gameState: GameState,
        legalActions: Action[],
        callback: (action: Action) => void,
      ): void => {
        const instance = this.instances.get(pluginId);
        if (!instance) {
          callback({
            type: 'error',
            playerId,
            data: { error: 'Plugin not loaded' },
            timestamp: Date.now(),
          });
          return;
        }

        this.sendPortMessage(instance.port, {
          type: 'AI_DECISION',
          pluginId,
          playerId,
          gameState,
          legalActions,
          requestId: this.generateRequestId(),
        }, 10000)
          .then((result) => {
            if (result.success && result.move) {
              callback(result.move);
            } else {
              callback({
                type: 'error',
                playerId,
                data: { error: result.error || 'AI decision failed' },
                timestamp: Date.now(),
              });
            }
          })
          .catch((err) => {
            callback({
              type: 'error',
              playerId,
              data: { error: err.message },
              timestamp: Date.now(),
            });
          });
      },
    };
  }

  // ==================== 公共 Worker 通信 API ====================

  /**
   * 发送消息到 Worker（通过 MessagePort）并等待响应
   * 10秒超时保护
   */
  sendPortMessage(
    port: MessagePort,
    message: any,
    timeoutMs: number,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = message.requestId || this.generateRequestId();
      message.requestId = requestId;

      // 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${message.type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // 存储 pending request
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
      });

      // 发送消息
      try {
        port.postMessage(message);
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error(`Failed to post message: ${err?.message}`));
      }
    });
  }

  /**
   * 调用插件导出方法（通过 Worker MessagePort）
   */
  async callPluginExport(
    pluginId: string,
    methodName: string,
    args: any[] = [],
    timeoutMs: number = 5000,
  ): Promise<any> {
    const instance = this.instances.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin "${pluginId}" is not loaded`);
    }

    return this.sendPortMessage(instance.port, {
      type: 'CALL_EXPORT',
      pluginId,
      methodName,
      args,
      requestId: this.generateRequestId(),
    }, timeoutMs);
  }

  /**
   * 发送消息到 Worker（初始通信，使用 Worker.postMessage）
   */
  private async sendWorkerMessage(
    worker: Worker,
    message: any,
    transferPort: MessagePort,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker initial message timeout'));
      }, 5000);

      const handler = (msg: any) => {
        if (msg.type === 'LOAD_PLUGIN_RESPONSE' || msg.type === 'WORKER_READY') {
          clearTimeout(timeout);
          worker.off('message', handler);
          resolve();
        }
      };

      worker.on('message', handler);

      try {
        worker.postMessage(message, [transferPort]);
      } catch (err: any) {
        clearTimeout(timeout);
        worker.off('message', handler);
        reject(err);
      }
    });
  }

  /**
   * 等待 Worker 响应（一次性）
   */
  private waitForResponse(port: MessagePort, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        port.off('message', handler);
        reject(new Error(`Wait for response timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (msg: any) => {
        clearTimeout(timer);
        port.off('message', handler);
        resolve(msg);
      };

      port.once('message', handler);
    });
  }

  /**
   * 设置 MessagePort 监听器
   */
  private setupPortListener(port: MessagePort, pluginId: string): void {
    const handler = (msg: any) => {
      // 处理响应
      if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
        const pending = this.pendingRequests.get(msg.requestId)!;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.requestId);
        pending.resolve(msg);
        return;
      }

      // 处理事件转发
      if (msg.type === 'EVENT_FORWARD') {
        this.logger.debug(
          `Event forwarded from Worker for "${pluginId}": ${msg.eventType}`,
        );
        return;
      }

      // 处理日志
      if (msg.type === 'LOG') {
        const prefix = `[Worker][${pluginId}]`;
        switch (msg.level) {
          case 'debug':
            this.logger.debug(`${prefix} ${msg.message}`);
            break;
          case 'info':
            this.logger.log(`${prefix} ${msg.message}`);
            break;
          case 'warn':
            this.logger.warn(`${prefix} ${msg.message}`);
            break;
          case 'error':
            this.logger.error(`${prefix} ${msg.message}`);
            break;
        }
        return;
      }

      // 处理崩溃通知
      if (msg.type === 'WORKER_CRASH') {
        this.logger.error(
          `Worker crash reported for plugin "${pluginId}": ${msg.error}`,
        );
        this.handleWorkerCrash(pluginId);
        return;
      }
    };

    port.on('message', handler);
  }

  /**
   * 设置 Worker 错误处理器
   */
  private setupWorkerErrorHandler(
    pooledWorker: PooledWorker,
    meta: PluginMeta,
  ): void {
    const errorHandler = (err: Error) => {
      this.logger.error(
        `Worker #${pooledWorker.threadId} error for plugin "${meta.pluginId}": ${err.message}`,
      );
      this.handleWorkerCrash(meta.pluginId);
    };

    const exitHandler = (code: number) => {
      if (code !== 0) {
        this.logger.error(
          `Worker #${pooledWorker.threadId} exited with code ${code} for plugin "${meta.pluginId}"`,
        );
        this.handleWorkerCrash(meta.pluginId);
      }
    };

    pooledWorker.worker.on('error', errorHandler);
    pooledWorker.worker.on('exit', exitHandler);

    this.workerErrorHandlers.set(pooledWorker.threadId, errorHandler);
    this.workerMessageHandlers.set(pooledWorker.threadId, exitHandler as any);
  }

  /**
   * 清理 Worker 处理器
   */
  private cleanupWorkerHandlers(threadId: number): void {
    this.workerErrorHandlers.delete(threadId);
    this.workerMessageHandlers.delete(threadId);
  }

  // ==================== 崩溃恢复 ====================

  /**
   * 处理 Worker 崩溃
   * 限制：最多3次重启/小时
   */
  private handleWorkerCrash(pluginId: string): void {
    const instance = this.instances.get(pluginId);
    if (!instance) return;

    // 检查重启窗口
    const now = Date.now();
    if (instance.lastRestartAt) {
      const timeSinceLastRestart = now - instance.lastRestartAt.getTime();
      if (timeSinceLastRestart > 60 * 60 * 1000) {
        // 超过1小时，重置计数
        instance.restartCount = 0;
      }
    }

    if (instance.restartCount >= 3) {
      this.logger.error(
        `Plugin "${pluginId}" exceeded max restarts (3/hour), marking as degraded`,
      );
      instance.status = 'degraded';
      return;
    }

    // 重新加载
    instance.restartCount++;
    instance.lastRestartAt = new Date();

    this.logger.warn(
      `Restarting plugin "${pluginId}" in new Worker (restart ${instance.restartCount}/3)`,
    );

    // 释放旧 Worker
    try {
      instance.port.close();
    } catch {
      // 忽略
    }
    this.workerPool.markWorkerCrashed(instance.pooledWorker);
    this.cleanupWorkerHandlers(instance.pooledWorker.threadId);

    // 重新加载
    const pluginPath = instance.meta.entryClass;
    this.load(pluginPath, instance.meta)
      .then(() => {
        this.logger.log(`Plugin "${pluginId}" restarted successfully`);
      })
      .catch((err) => {
        this.logger.error(`Failed to restart plugin "${pluginId}": ${err.message}`);
        instance.status = 'error';
      });
  }

  // ==================== 游戏操作 ====================

  /**
   * 发送游戏动作到 Worker
   */
  private async sendGameAction(pluginId: string, action: Action): Promise<any> {
    const instance = this.instances.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin "${pluginId}" is not loaded`);
    }

    const result = await this.sendPortMessage(instance.port, {
      type: 'GAME_ACTION',
      pluginId,
      action,
      requestId: this.generateRequestId(),
    }, 10000);

    if (!result.success) {
      throw new Error(result.error || 'Game action failed');
    }

    return result.result;
  }

  // ==================== 内存监控 ====================

  private startMemoryMonitoring(): void {
    this.memoryCheckTimer = setInterval(() => {
      this.checkMemoryUsage();
    }, this.memoryCheckIntervalMs);
  }

  private async checkMemoryUsage(): Promise<void> {
    if (this.destroyed) return;

    for (const [pluginId, instance] of this.instances) {
      const limit = instance.meta.memoryLimitMB ?? 128;
      const stats = this.memoryStats.get(pluginId);
      if (!stats) continue;

      try {
        // 通过 MessagePort 查询 Worker 内存使用
        const result = await this.sendPortMessage(instance.port, {
          type: 'GET_MEMORY_USAGE',
          requestId: this.generateRequestId(),
        }, 5000);

        if (result.success && result.memory) {
          const usedMB = Math.round(result.memory.heapUsed / 1024 / 1024);
          stats.peakMB = Math.max(stats.peakMB, usedMB);
          instance.memoryUsageMB = usedMB;

          if (usedMB > limit) {
            stats.violations++;
            this.logger.warn(
              `Plugin "${pluginId}" memory usage (${usedMB}MB) exceeds limit (${limit}MB), violation #${stats.violations}`,
            );

            if (stats.violations >= this.memoryViolationThreshold) {
              this.logger.error(
                `Plugin "${pluginId}" exceeded memory limit ${this.memoryViolationThreshold} times, degrading...`,
              );
              instance.status = 'degraded';
            }
          } else {
            if (stats.violations > 0) {
              stats.violations = Math.max(0, stats.violations - 1);
            }
            if (instance.status === 'degraded' && stats.violations === 0) {
              instance.status = 'running';
            }
          }
        }
      } catch (err: any) {
        // 内存查询失败，可能是 Worker 已崩溃
        this.logger.warn(
          `Memory check failed for "${pluginId}": ${err?.message}`,
        );
      }
    }
  }

  // ==================== 工具方法 ====================

  generateRequestId(): string {
    return `req_${++this.requestCounter}_${Date.now()}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
