import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GameState, Action } from '../plugin/interfaces/game-controller.interface';
import {
  AIInstance,
  AIInstanceStatus,
  AIEngineStats,
  DifficultyConfig,
  WorkerMessage,
  WorkerResponse,
} from './interfaces/ai-instance.interface';
import { AiProcessPoolService } from './ai-process-pool.service';

/**
 * 难度配置映射
 * 每种难度对应不同的引擎类型和参数
 */
const DIFFICULTY_CONFIGS: Record<string, DifficultyConfig> = {
  easy: {
    engineType: 'random',
    randomize: true,
    timeoutMs: 3000,
  },
  medium: {
    engineType: 'mcts',
    maxIterations: 500,
    explorationConstant: 1.414,
    parallelSims: 2,
    timeoutMs: 5000,
  },
  hard: {
    engineType: 'minimax',
    maxDepth: 6,
    randomize: true,
    timeoutMs: 8000,
  },
  expert: {
    engineType: 'mcts',
    maxIterations: 5000,
    explorationConstant: 1.2,
    parallelSims: 4,
    timeoutMs: 15000,
  },
};

/**
 * AI引擎主服务
 * 
 * 职责：
 * 1. 管理AI实例生命周期（创建、使用、释放）
 * 2. 协调AI决策请求（通过进程池调度工作进程）
 * 3. 提供超时控制机制
 * 4. 收集和报告AI引擎统计信息
 * 
 * 技术要点：
 * - 使用异步Promise + 超时机制
 * - 通过进程池实现真正的并行计算
 * - 支持多种难度级别和引擎类型
 * - 内存监控和优雅降级
 */
@Injectable()
export class AiEngineService {
  private readonly logger = new Logger(AiEngineService.name);

  // AI实例存储
  private instances: Map<string, AIInstance> = new Map();

  // 响应时间追踪
  private responseTimes: number[] = [];
  private readonly MAX_RESPONSE_TIME_HISTORY = 100;

  constructor(private readonly processPool: AiProcessPoolService) {}

  /**
   * 创建AI实例
   * 
   * @param pluginId 游戏插件ID
   * @param difficulty 难度级别（easy/medium/hard/expert）
   * @param options 额外选项
   * @returns 创建的AI实例
   */
  async createAI(
    pluginId: string,
    difficulty: string,
    options?: Record<string, any>
  ): Promise<AIInstance> {
    // 验证难度
    if (!DIFFICULTY_CONFIGS[difficulty]) {
      throw new BadRequestException(
        `Invalid difficulty '${difficulty}'. Must be one of: ${Object.keys(DIFFICULTY_CONFIGS).join(', ')}`
      );
    }

    const instanceId = `ai-${pluginId}-${difficulty}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const instance: AIInstance = {
      instanceId,
      pluginId,
      difficulty,
      status: 'idle',
      createdAt: now,
      lastUsedAt: now,
      totalRequests: 0,
    };

    this.instances.set(instanceId, instance);
    this.logger.log(`Created AI instance: ${instanceId} (plugin=${pluginId}, difficulty=${difficulty})`);

    return instance;
  }

  /**
   * 请求AI决策（带超时控制）
   * 
   * 使用 Promise.race 实现超时机制：
   * - aiPromise: AI工作进程的搜索任务
   * - timeoutPromise: 超时拒绝
   * 
   * @param instanceId AI实例ID
   * @param playerId 当前玩家ID
   * @param gameState 当前游戏状态
   * @param legalActions 合法动作列表
   * @param timeoutMs 超时时间（毫秒）
   * @returns AI选择的动作
   */
  async requestAction(
    instanceId: string,
    playerId: string,
    gameState: GameState,
    legalActions: Action[],
    timeoutMs: number = 10000
  ): Promise<Action> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new NotFoundException(`AI instance '${instanceId}' not found`);
    }

    if (!legalActions || legalActions.length === 0) {
      throw new BadRequestException('No legal actions provided');
    }

    if (legalActions.length === 1) {
      return legalActions[0];
    }

    const startTime = Date.now();
    const difficultyConfig = DIFFICULTY_CONFIGS[instance.difficulty];
    const effectiveTimeout = Math.min(timeoutMs, difficultyConfig.timeoutMs || timeoutMs);

    // 更新实例状态
    instance.status = 'thinking';
    instance.lastUsedAt = new Date();
    instance.totalRequests++;

    try {
      // 获取进程池中的工作进程
      const process = await this.processPool.acquireProcess();

      // 创建AI搜索Promise
      const aiPromise = this.executeSearch(
        process.processId,
        instanceId,
        instance.pluginId,
        difficultyConfig,
        gameState,
        playerId,
        legalActions,
        effectiveTimeout
      );

      // 创建超时Promise
      const timeoutPromise = new Promise<Action>((_, reject) => {
        setTimeout(() => {
          // 发送停止信号到Worker
          this.sendStopSignal(process.processId, instanceId);
          reject(new Error(`AI decision timed out after ${effectiveTimeout}ms`));
        }, effectiveTimeout);
      });

      // 竞争：先完成的获胜
      const action = await Promise.race([aiPromise, timeoutPromise]);

      // 释放进程
      this.processPool.releaseProcess(process.processId);

      // 记录响应时间
      const elapsedMs = Date.now() - startTime;
      this.recordResponseTime(elapsedMs);

      instance.status = 'idle';
      this.logger.debug(`AI decision completed in ${elapsedMs}ms for instance ${instanceId}`);

      return action;
    } catch (error) {
      instance.status = 'error';

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI decision failed for instance ${instanceId}: ${errorMessage}`);

      // 错误时降级到随机选择
      this.logger.warn(`Falling back to random action for instance ${instanceId}`);
      return legalActions[Math.floor(Math.random() * legalActions.length)];
    }
  }

  /**
   * 释放AI实例
   * 
   * @param instanceId AI实例ID
   */
  async releaseAI(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new NotFoundException(`AI instance '${instanceId}' not found`);
    }

    this.instances.delete(instanceId);
    this.logger.log(`Released AI instance: ${instanceId}`);
  }

  /**
   * 获取AI实例状态
   * 
   * @param instanceId AI实例ID
   * @returns 实例状态详情
   */
  getInstanceStatus(instanceId: string): AIInstanceStatus {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new NotFoundException(`AI instance '${instanceId}' not found`);
    }

    const status: AIInstanceStatus = {
      instanceId: instance.instanceId,
      pluginId: instance.pluginId,
      difficulty: instance.difficulty,
      status: instance.status,
      createdAt: instance.createdAt,
      lastUsedAt: instance.lastUsedAt,
      totalRequests: instance.totalRequests,
    };

    // 如果正在思考，添加当前任务信息
    if (instance.status === 'thinking') {
      status.currentTask = {
        playerId: 'unknown', // 实际实现中可以从活跃任务追踪获取
        startTime: instance.lastUsedAt,
        elapsedMs: Date.now() - instance.lastUsedAt.getTime(),
      };
    }

    return status;
  }

  /**
   * 获取AI引擎统计信息
   * 
   * @returns 引擎统计
   */
  getStats(): AIEngineStats {
    let activeCount = 0;
    let idleCount = 0;
    let errorCount = 0;
    let totalRequests = 0;

    for (const instance of this.instances.values()) {
      totalRequests += instance.totalRequests;
      switch (instance.status) {
        case 'thinking':
          activeCount++;
          break;
        case 'idle':
          idleCount++;
          break;
        case 'error':
          errorCount++;
          break;
      }
    }

    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    const poolStats = this.processPool.getStats();

    return {
      totalInstances: this.instances.size,
      activeInstances: activeCount,
      idleInstances: idleCount,
      errorInstances: errorCount,
      totalRequests,
      averageResponseTimeMs: Math.round(avgResponseTime),
      poolStats: {
        totalProcesses: poolStats.currentPoolSize,
        idleProcesses: poolStats.idleCount,
        busyProcesses: poolStats.busyCount,
        errorProcesses: poolStats.currentPoolSize - poolStats.idleCount - poolStats.busyCount,
      },
    };
  }

  /**
   * 获取所有活跃实例
   */
  getAllInstances(): AIInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * 获取支持的难度级别
   */
  getSupportedDifficulties(): string[] {
    return Object.keys(DIFFICULTY_CONFIGS);
  }

  /**
   * 获取难度配置
   */
  getDifficultyConfig(difficulty: string): DifficultyConfig | undefined {
    return DIFFICULTY_CONFIGS[difficulty];
  }

  // ==================== 私有方法 ====================

  /**
   * 执行AI搜索 - 通过进程池工作进程
   */
  private async executeSearch(
    processId: string,
    instanceId: string,
    pluginId: string,
    config: DifficultyConfig,
    gameState: GameState,
    playerId: string,
    legalActions: Action[],
    timeoutMs: number
  ): Promise<Action> {
    return new Promise((resolve, reject) => {
      const proc = this.processPool['pool'].get(processId);
      if (!proc) {
        reject(new Error(`Process ${processId} not found`));
        return;
      }

      // 设置Worker消息监听
      const messageHandler = (message: WorkerResponse) => {
        if (message.instanceId !== instanceId) return;

        // 清理监听器
        proc.worker.off('message', messageHandler);
        proc.worker.off('error', errorHandler);

        if (message.type === 'search_result' && message.action) {
          proc.totalTasks++;
          resolve(message.action);
        } else if (message.type === 'error') {
          reject(new Error(message.error || 'AI search failed'));
        }
      };

      const errorHandler = (error: Error) => {
        proc.worker.off('message', messageHandler);
        proc.worker.off('error', errorHandler);
        reject(error);
      };

      proc.worker.on('message', messageHandler);
      proc.worker.on('error', errorHandler);

      // 发送搜索任务到Worker
      const message: WorkerMessage = {
        type: 'search',
        instanceId,
        pluginId,
        engineType: config.engineType,
        gameState,
        playerId,
        legalActions,
        options: {
          maxDepth: config.maxDepth,
          maxIterations: config.maxIterations,
          explorationConstant: config.explorationConstant,
          randomize: config.randomize,
          parallelSims: config.parallelSims,
          temperature: instanceId.includes('easy') ? 1.5 : 0.5,
        },
        timeoutMs,
      };

      proc.worker.postMessage(message);
    });
  }

  /**
   * 发送停止信号到Worker
   */
  private sendStopSignal(processId: string, instanceId: string): void {
    try {
      const proc = this.processPool['pool'].get(processId);
      if (proc) {
        const message: WorkerMessage = {
          type: 'stop',
          instanceId,
        };
        proc.worker.postMessage(message);
      }
    } catch (error) {
      this.logger.error(`Failed to send stop signal to ${processId}:`, error);
    }
  }

  /**
   * 记录响应时间
   */
  private recordResponseTime(ms: number): void {
    this.responseTimes.push(ms);
    if (this.responseTimes.length > this.MAX_RESPONSE_TIME_HISTORY) {
      this.responseTimes.shift();
    }
  }
}
