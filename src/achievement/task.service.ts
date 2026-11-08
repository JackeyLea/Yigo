/**
 * TaskService - 任务业务逻辑层
 *
 * 负责处理日常任务、周常任务的管理、进度追踪、完成检查和奖励领取。
 * 支持任务周期刷新（每日/每周）、进度持久化和奖励发放。
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

import {
  TaskDefinition,
  TaskType,
} from './entities/task-definition.entity';
import {
  UserTaskProgress,
  TaskStatus,
} from './entities/user-task-progress.entity';
import { Wallet } from '../common/entities/wallet.entity';
import { Transaction, TransactionType } from '../common/entities/transaction.entity';
import { User } from '../common/entities/user.entity';

import {
  Reward,
  TaskProgress,
  GameEvent,
} from './interfaces';

/** 任务DTO */
export interface TaskItem {
  taskId: string;
  taskCode: string;
  name: string;
  description: string;
  type: TaskType;
  iconUrl: string | null;
  requirement: Record<string, any>;
  reward: Record<string, any>;
  sortOrder: number;
  createdAt: Date;
}

/** 用户任务DTO */
export interface UserTaskItem {
  id: string;
  userId: string;
  task: TaskItem;
  status: TaskStatus;
  progressJson: Record<string, any>;
  completedAt: Date | null;
  claimedAt: Date | null;
  cycleStart: Date;
  cycleEnd: Date;
}

/** 任务查询选项 */
export interface TaskQueryOptions {
  userId: number;
  type?: TaskType;
  includeExpired?: boolean;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);
  private readonly redis: Redis;

  // 内置默认任务（种子数据兜底）
  private readonly defaultDailyTasks: Array<Partial<TaskDefinition>> = [
    {
      task_code: 'daily_play_1',
      name: '每日对局',
      description: '完成1场任意游戏对局',
      task_type: TaskType.DAILY,
      requirement_json: { eventType: 'game_played', count: 1 },
      reward_json: { type: 'currency', value: 100, currency: 'COIN' },
      sort_order: 1,
    },
    {
      task_code: 'daily_win_1',
      name: '每日首胜',
      description: '赢得1场任意游戏对局',
      task_type: TaskType.DAILY,
      requirement_json: { eventType: 'game_won', count: 1 },
      reward_json: { type: 'currency', value: 200, currency: 'COIN' },
      sort_order: 2,
    },
    {
      task_code: 'daily_login',
      name: '每日签到',
      description: '登录游戏',
      task_type: TaskType.DAILY,
      requirement_json: { eventType: 'login', count: 1 },
      reward_json: { type: 'xp', value: 50 },
      sort_order: 3,
    },
    {
      task_code: 'daily_social',
      name: '每日社交',
      description: '添加1个好友',
      task_type: TaskType.DAILY,
      requirement_json: { eventType: 'social', action: 'add_friend', count: 1 },
      reward_json: { type: 'currency', value: 50, currency: 'COIN' },
      sort_order: 4,
    },
  ];

  private readonly defaultWeeklyTasks: Array<Partial<TaskDefinition>> = [
    {
      task_code: 'weekly_play_10',
      name: '周常对局',
      description: '完成10场任意游戏对局',
      task_type: TaskType.WEEKLY,
      requirement_json: { eventType: 'game_played', count: 10 },
      reward_json: { type: 'currency', value: 1000, currency: 'COIN' },
      sort_order: 1,
    },
    {
      task_code: 'weekly_win_5',
      name: '周常胜利',
      description: '赢得5场任意游戏对局',
      task_type: TaskType.WEEKLY,
      requirement_json: { eventType: 'game_won', count: 5 },
      reward_json: { type: 'xp', value: 500 },
      sort_order: 2,
    },
    {
      task_code: 'weekly_streak_3',
      name: '连胜达人',
      description: '取得3连胜',
      task_type: TaskType.WEEKLY,
      requirement_json: { eventType: 'streak', count: 3 },
      reward_json: { type: 'currency', value: 500, currency: 'COIN' },
      sort_order: 3,
    },
    {
      task_code: 'weekly_special_move',
      name: '技巧展示',
      description: '完成3次特殊移动',
      task_type: TaskType.WEEKLY,
      requirement_json: { eventType: 'special_move', count: 3 },
      reward_json: { type: 'item', value: 'special_chess_piece' },
      sort_order: 4,
    },
  ];

  constructor(
    @InjectRepository(TaskDefinition)
    private readonly taskDefinitionRepository: Repository<TaskDefinition>,
    @InjectRepository(UserTaskProgress)
    private readonly userTaskProgressRepository: Repository<UserTaskProgress>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
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

  // ============================================================
  // 1. 任务查询
  // ============================================================

  /**
   * 获取每日任务列表
   *
   * 返回用户的每日任务及其进度状态。
   * 如果任务周期已过期，会自动刷新。
   *
   * @param userId - 用户ID
   * @returns 每日任务列表（含进度）
   */
  async getDailyTasks(userId: number): Promise<UserTaskItem[]> {
    return this.getTasksByType(userId, TaskType.DAILY);
  }

  /**
   * 获取每周任务列表
   *
   * 返回用户的每周任务及其进度状态。
   * 如果任务周期已过期，会自动刷新。
   *
   * @param userId - 用户ID
   * @returns 每周任务列表（含进度）
   */
  async getWeeklyTasks(userId: number): Promise<UserTaskItem[]> {
    return this.getTasksByType(userId, TaskType.WEEKLY);
  }

  /**
   * 按类型获取任务
   *
   * @param userId - 用户ID
   * @param type - 任务类型
   * @returns 用户任务列表
   */
  private async getTasksByType(
    userId: number,
    type: TaskType,
  ): Promise<UserTaskItem[]> {
    const userIdStr = String(userId);

    // 1. 获取任务定义
    const taskDefinitions = await this.getTaskDefinitions(type);

    // 2. 获取或创建用户任务进度
    const userTasks = await this.getOrCreateUserTasks(
      userIdStr,
      taskDefinitions,
    );

    // 3. 映射为DTO
    return userTasks
      .map((ut) => this.mapToUserTaskItem(ut))
      .sort((a, b) => a.task.sortOrder - b.task.sortOrder);
  }

  // ============================================================
  // 2. 任务完成与奖励
  // ============================================================

  /**
   * 完成任务并领取奖励
   *
   * 检查任务是否已完成，如果完成则发放奖励。
   * 只能对已完成且未领取奖励的任务调用此方法。
   *
   * @param userId - 用户ID
   * @param taskId - 任务ID
   * @returns 领取的奖励
   */
  async completeTask(userId: number, taskId: number): Promise<Reward> {
    const userIdStr = String(userId);
    const taskIdStr = String(taskId);

    // 1. 查找用户任务进度
    const userTask = await this.userTaskProgressRepository.findOne({
      where: {
        user_id: userIdStr,
        task_id: taskIdStr,
      },
      relations: ['task_definition'],
    });

    if (!userTask) {
      throw new NotFoundException(
        `任务进度不存在: userId=${userId}, taskId=${taskId}`,
      );
    }

    if (userTask.status === TaskStatus.CLAIMED) {
      throw new BadRequestException('任务奖励已领取');
    }

    if (userTask.status !== TaskStatus.COMPLETED) {
      // 检查是否已满足完成条件
      const isCompleted = this.checkTaskCompletion(userTask);
      if (!isCompleted) {
        throw new BadRequestException('任务尚未完成');
      }
      // 更新状态为已完成
      userTask.status = TaskStatus.COMPLETED;
      userTask.completed_at = new Date();
      await this.userTaskProgressRepository.save(userTask);
    }

    // 2. 发放奖励
    const rewardConfig = userTask.task_definition.reward_json;
    const reward = await this.processTaskReward(
      userIdStr,
      rewardConfig,
      userTask.task_definition,
    );

    // 3. 标记为已领取
    userTask.status = TaskStatus.CLAIMED;
    userTask.claimed_at = new Date();
    await this.userTaskProgressRepository.save(userTask);

    this.logger.log(
      `User ${userId} completed and claimed task: ${userTask.task_definition.name}`,
    );

    return reward;
  }

  /**
   * 获取任务进度
   *
   * @param userId - 用户ID
   * @param taskId - 任务ID
   * @returns 任务进度详情
   */
  async getTaskProgress(userId: number, taskId: number): Promise<TaskProgress> {
    const userIdStr = String(userId);
    const taskIdStr = String(taskId);

    // 查询任务定义
    const taskDef = await this.taskDefinitionRepository.findOne({
      where: { task_id: taskIdStr },
    });

    if (!taskDef) {
      throw new NotFoundException(`任务不存在: ${taskId}`);
    }

    // 查询用户任务进度
    let userTask = await this.userTaskProgressRepository.findOne({
      where: {
        user_id: userIdStr,
        task_id: taskIdStr,
      },
    });

    if (!userTask) {
      // 创建新的进度记录
      const cycleDates = this.getCycleDates(taskDef.task_type);
      userTask = this.userTaskProgressRepository.create({
        user_id: userIdStr,
        task_id: taskIdStr,
        status: TaskStatus.PENDING,
        progress_json: this.initializeTaskProgress(taskDef.requirement_json),
        cycle_start: cycleDates.start,
        cycle_end: cycleDates.end,
      });
      await this.userTaskProgressRepository.save(userTask);
    }

    // 计算进度
    const progress = userTask.progress_json;
    const requirement = taskDef.requirement_json;
    const { current, target } = this.calculateTaskProgressMetrics(
      progress,
      requirement,
    );
    const percentage =
      target > 0 ? Math.min(100, Math.floor((current / target) * 100)) : 0;

    return {
      taskId: taskDef.task_id,
      taskCode: taskDef.task_code,
      name: taskDef.name,
      description: taskDef.description,
      currentProgress: current,
      targetProgress: target,
      percentage,
      status: userTask.status as any,
      completedAt: userTask.completed_at || undefined,
      claimedAt: userTask.claimed_at || undefined,
      expiresAt: userTask.cycle_end,
    };
  }

  // ============================================================
  // 3. 事件驱动任务更新
  // ============================================================

  /**
   * 处理游戏事件，更新任务进度
   *
   * 当用户触发游戏事件时，自动检查并更新相关任务进度。
   * 如果任务完成，自动标记状态。
   *
   * @param userId - 用户ID
   * @param event - 游戏事件
   * @returns 更新后的用户任务列表
   */
  async handleGameEvent(
    userId: number,
    event: GameEvent,
  ): Promise<UserTaskItem[]> {
    const userIdStr = String(userId);

    // 1. 获取相关的活跃任务
    const activeUserTasks = await this.getActiveUserTasks(userIdStr, event.type);

    if (activeUserTasks.length === 0) {
      return [];
    }

    const updatedTasks: UserTaskItem[] = [];

    for (const userTask of activeUserTasks) {
      if (
        userTask.status === TaskStatus.COMPLETED ||
        userTask.status === TaskStatus.CLAIMED
      ) {
        continue;
      }

      // 更新进度
      const newProgress = this.updateTaskProgress(
        userTask.progress_json,
        userTask.task_definition.requirement_json,
        event,
      );

      if (newProgress) {
        userTask.progress_json = newProgress;

        // 检查是否完成
        const isCompleted = this.checkTaskCompletion(userTask);
        if (isCompleted) {
          userTask.status = TaskStatus.COMPLETED;
          userTask.completed_at = new Date();
          this.logger.debug(
            `Task ${userTask.task_definition.name} completed for user ${userId}`,
          );
        } else {
          userTask.status = TaskStatus.IN_PROGRESS;
        }

        await this.userTaskProgressRepository.save(userTask);
        updatedTasks.push(this.mapToUserTaskItem(userTask));
      }
    }

    return updatedTasks;
  }

  // ============================================================
  // 4. 内部辅助方法
  // ============================================================

  /**
   * 获取任务定义列表
   *
   * 优先从数据库读取，如果数据库为空则使用默认内置任务
   *
   * @param type - 任务类型
   * @returns 任务定义列表
   */
  private async getTaskDefinitions(
    type: TaskType,
  ): Promise<TaskDefinition[]> {
    const definitions = await this.taskDefinitionRepository.find({
      where: { task_type: type, is_enabled: true },
      order: { sort_order: 'ASC' },
    });

    if (definitions.length > 0) {
      return definitions;
    }

    // 数据库为空，使用默认内置任务
    this.logger.warn(
      `No ${type} tasks found in database, using defaults`,
    );

    const defaults =
      type === TaskType.DAILY
        ? this.defaultDailyTasks
        : this.defaultWeeklyTasks;

    // 将默认任务保存到数据库以便后续使用
    const newDefinitions = defaults.map(
      (d) => this.taskDefinitionRepository.create(d as TaskDefinition),
    );

    return this.taskDefinitionRepository.save(newDefinitions);
  }

  /**
   * 获取或创建用户任务进度
   *
   * 检查任务周期是否过期，如果过期则重置进度
   *
   * @param userIdStr - 用户ID字符串
   * @param taskDefinitions - 任务定义列表
   * @returns 用户任务进度列表
   */
  private async getOrCreateUserTasks(
    userIdStr: string,
    taskDefinitions: TaskDefinition[],
  ): Promise<UserTaskProgress[]> {
    const taskIds = taskDefinitions.map((td) => td.task_id);
    const now = new Date();

    // 查询现有的进度记录
    const existingTasks = await this.userTaskProgressRepository.find({
      where: {
        user_id: userIdStr,
        task_id: InArray(taskIds),
      },
      relations: ['task_definition'],
    });

    const existingMap = new Map(existingTasks.map((t) => [t.task_id, t]));
    const result: UserTaskProgress[] = [];

    for (const taskDef of taskDefinitions) {
      let userTask = existingMap.get(taskDef.task_id);
      const cycleDates = this.getCycleDates(taskDef.task_type);

      if (!userTask) {
        // 创建新记录
        userTask = this.userTaskProgressRepository.create({
          user_id: userIdStr,
          task_id: taskDef.task_id,
          status: TaskStatus.PENDING,
          progress_json: this.initializeTaskProgress(taskDef.requirement_json),
          cycle_start: cycleDates.start,
          cycle_end: cycleDates.end,
        });
        userTask = await this.userTaskProgressRepository.save(userTask);
        userTask.task_definition = taskDef;
      } else if (now > userTask.cycle_end) {
        // 周期已过期，重置进度
        userTask.status = TaskStatus.PENDING;
        userTask.progress_json = this.initializeTaskProgress(
          taskDef.requirement_json,
        );
        userTask.completed_at = null;
        userTask.claimed_at = null;
        userTask.cycle_start = cycleDates.start;
        userTask.cycle_end = cycleDates.end;
        userTask = await this.userTaskProgressRepository.save(userTask);
        userTask.task_definition = taskDef;
      }

      // 确保关联存在
      if (!userTask.task_definition) {
        userTask.task_definition = taskDef;
      }

      result.push(userTask);
    }

    return result;
  }

  /**
   * 获取当前周期的时间范围
   *
   * @param type - 任务类型
   * @returns 周期开始和结束时间
   */
  private getCycleDates(type: TaskType): { start: Date; end: Date } {
    const now = new Date();

    if (type === TaskType.DAILY) {
      // 每日任务：从当天0:00到次日0:00
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0,
      );
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    } else {
      // 每周任务：从本周一0:00到下周一0:00
      const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ...
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - diffToMonday,
        0,
        0,
        0,
        0,
      );
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
  }

  /**
   * 初始化任务进度
   *
   * @param requirement - 任务要求
   * @returns 初始进度对象
   */
  private initializeTaskProgress(
    requirement: Record<string, any>,
  ): Record<string, any> {
    const progress: Record<string, any> = {};
    const eventType = requirement.eventType || requirement.type;

    switch (eventType) {
      case 'game_played':
        progress.gamesPlayed = 0;
        break;
      case 'game_won':
        progress.gamesWon = 0;
        break;
      case 'streak':
        progress.maxStreak = 0;
        break;
      case 'special_move':
        progress.specialMoves = 0;
        break;
      case 'social':
        progress.socialActions = 0;
        break;
      case 'login':
        progress.loginCount = 0;
        break;
      default:
        progress.count = 0;
        break;
    }

    return progress;
  }

  /**
   * 更新任务进度
   *
   * @param currentProgress - 当前进度
   * @param requirement - 任务要求
   * @param event - 游戏事件
   * @returns 更新后的进度（如果没有变化返回null）
   */
  private updateTaskProgress(
    currentProgress: Record<string, any>,
    requirement: Record<string, any>,
    event: GameEvent,
  ): Record<string, any> | null {
    const eventType = requirement.eventType || requirement.type;

    // 事件类型不匹配
    if (event.type !== eventType) {
      return null;
    }

    const progress = { ...currentProgress };

    switch (event.type) {
      case 'game_played':
        progress.gamesPlayed = (progress.gamesPlayed || 0) + (event.count || 1);
        break;

      case 'game_won':
        progress.gamesWon = (progress.gamesWon || 0) + 1;
        break;

      case 'streak':
        progress.maxStreak = Math.max(
          progress.maxStreak || 0,
          event.count,
        );
        break;

      case 'special_move':
        progress.specialMoves = (progress.specialMoves || 0) + 1;
        break;

      case 'social':
        // 检查action是否匹配
        if (requirement.action && event.action !== requirement.action) {
          return null;
        }
        progress.socialActions =
          (progress.socialActions || 0) + (event.count || 1);
        break;

      case 'login':
        progress.loginCount = (progress.loginCount || 0) + 1;
        break;

      default:
        return null;
    }

    return progress;
  }

  /**
   * 检查任务是否已完成
   *
   * @param userTask - 用户任务进度
   * @returns 是否已完成
   */
  private checkTaskCompletion(userTask: UserTaskProgress): boolean {
    const progress = userTask.progress_json;
    const requirement = userTask.task_definition.requirement_json;
    const { current, target } = this.calculateTaskProgressMetrics(
      progress,
      requirement,
    );
    return current >= target;
  }

  /**
   * 计算任务进度指标
   *
   * @param progress - 当前进度
   * @param requirement - 任务要求
   * @returns 当前值和目标值
   */
  private calculateTaskProgressMetrics(
    progress: Record<string, any>,
    requirement: Record<string, any>,
  ): { current: number; target: number } {
    const eventType = requirement.eventType || requirement.type;
    const target = requirement.count || 1;

    switch (eventType) {
      case 'game_played':
        return { current: progress.gamesPlayed || 0, target };
      case 'game_won':
        return { current: progress.gamesWon || 0, target };
      case 'streak':
        return { current: progress.maxStreak || 0, target };
      case 'special_move':
        return { current: progress.specialMoves || 0, target };
      case 'social':
        return { current: progress.socialActions || 0, target };
      case 'login':
        return { current: progress.loginCount || 0, target };
      default:
        return { current: progress.count || 0, target };
    }
  }

  /**
   * 获取与事件相关的活跃任务
   *
   * @param userIdStr - 用户ID字符串
   * @param eventType - 事件类型
   * @returns 活跃的用户任务列表
   */
  private async getActiveUserTasks(
    userIdStr: string,
    eventType: string,
  ): Promise<UserTaskProgress[]> {
    const now = new Date();

    // 获取所有未过期的任务进度
    const userTasks = await this.userTaskProgressRepository
      .createQueryBuilder('utp')
      .innerJoinAndSelect('utp.task_definition', 'td')
      .where('utp.user_id = :userId', { userId: userIdStr })
      .andWhere('utp.cycle_end > :now', { now })
      .andWhere('utp.status IN (:...statuses)', {
        statuses: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
      })
      .andWhere(
        `(td.requirement_json->>'eventType' = :eventType 
          OR td.requirement_json->>'type' = :eventType)`,
        { eventType },
      )
      .getMany();

    return userTasks;
  }

  /**
   * 处理任务奖励发放
   *
   * @param userIdStr - 用户ID字符串
   * @param rewardConfig - 奖励配置
   * @param taskDef - 任务定义
   * @returns 奖励信息
   */
  private async processTaskReward(
    userIdStr: string,
    rewardConfig: Record<string, any>,
    taskDef: TaskDefinition,
  ): Promise<Reward> {
    const rewardType = rewardConfig.type || 'xp';
    const rewardValue = rewardConfig.value || 0;
    const currency = rewardConfig.currency || 'COIN';

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      switch (rewardType) {
        case 'currency':
          await this.grantCurrency(queryRunner, userIdStr, currency, Number(rewardValue));
          break;

        case 'xp':
          await this.grantXp(queryRunner, userIdStr, Number(rewardValue));
          break;

        case 'title':
          await this.redis.sadd(`user:${userIdStr}:titles`, String(rewardValue));
          break;

        case 'item':
        case 'badge':
          await this.redis.sadd(
            `user:${userIdStr}:${rewardType}s`,
            String(rewardValue),
          );
          break;

        default:
          this.logger.warn(`Unknown reward type: ${rewardType}`);
      }

      await queryRunner.commitTransaction();

      return {
        achievementId: taskDef.task_id,
        achievementName: taskDef.name,
        rewardType: rewardType as any,
        rewardValue,
        currency: rewardType === 'currency' ? currency : undefined,
        claimedAt: new Date(),
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to process task reward: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('任务奖励发放失败');
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 发放货币奖励
   */
  private async grantCurrency(
    queryRunner: any,
    userIdStr: string,
    currency: string,
    amount: number,
  ): Promise<void> {
    const manager = queryRunner.manager;

    let wallet = await manager
      .createQueryBuilder(Wallet, 'wallet')
      .setLock('pessimistic_write')
      .where('wallet.user_id = :userId AND wallet.currency = :currency', {
        userId: userIdStr,
        currency,
      })
      .getOne();

    if (!wallet) {
      wallet = manager.create(Wallet, {
        user_id: userIdStr,
        currency,
        balance: '0',
        frozen: '0',
        total_deposited: '0',
        total_withdrawn: '0',
      });
    }

    const newBalance = (parseFloat(wallet.balance) + amount).toFixed(4);
    wallet.balance = newBalance;
    wallet.total_deposited = (
      parseFloat(wallet.total_deposited) + amount
    ).toFixed(4);

    await manager.save(Wallet, wallet);

    // 创建交易记录
    const txRepo = manager.getRepository(Transaction);
    const tx = txRepo.create({
      user_id: userIdStr,
      tx_type: TransactionType.GAME_SETTLE,
      amount: amount.toFixed(4),
      currency,
      balance_after: newBalance,
      reference_id: null,
      reference_type: 'task_reward',
    });
    await txRepo.save(tx);
  }

  /**
   * 发放经验值奖励
   */
  private async grantXp(
    queryRunner: any,
    userIdStr: string,
    amount: number,
  ): Promise<void> {
    const manager = queryRunner.manager;

    const user = await manager
      .createQueryBuilder(User, 'user')
      .setLock('pessimistic_write')
      .where('user.user_id = :userId', { userId: userIdStr })
      .getOne();

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const currentXp = BigInt(user.xp || '0');
    const newXp = (currentXp + BigInt(amount)).toString();
    user.xp = newXp;

    // 等级计算：每1000 XP升一级
    const newLevel = Math.floor(Number(newXp) / 1000) + 1;
    if (newLevel > user.level) {
      user.level = newLevel;
      this.logger.log(`User ${userIdStr} leveled up to ${newLevel}`);
    }

    await manager.save(User, user);
  }

  /**
   * 映射为用户任务DTO
   */
  private mapToUserTaskItem(userTask: UserTaskProgress): UserTaskItem {
    const td = userTask.task_definition;

    return {
      id: userTask.id,
      userId: userTask.user_id,
      task: {
        taskId: td.task_id,
        taskCode: td.task_code,
        name: td.name,
        description: td.description,
        type: td.task_type,
        iconUrl: td.icon_url,
        requirement: td.requirement_json,
        reward: td.reward_json,
        sortOrder: td.sort_order,
        createdAt: td.created_at,
      },
      status: userTask.status,
      progressJson: userTask.progress_json,
      completedAt: userTask.completed_at,
      claimedAt: userTask.claimed_at,
      cycleStart: userTask.cycle_start,
      cycleEnd: userTask.cycle_end,
    };
  }

  // ============================================================
  // 5. 手动刷新任务
  // ============================================================

  /**
   * 手动刷新用户的任务列表
   *
   * 通常在周期切换时调用（每日/每周），会重置过期任务。
   *
   * @param userId - 用户ID
   * @param type - 任务类型（可选，不指定则刷新所有）
   */
  async refreshTasks(userId: number, type?: TaskType): Promise<void> {
    const userIdStr = String(userId);
    const now = new Date();

    const where: any = { user_id: userIdStr };
    if (type) {
      // 需要通过关联查询筛选类型
      const tasksToRefresh = await this.userTaskProgressRepository
        .createQueryBuilder('utp')
        .innerJoinAndSelect('utp.task_definition', 'td')
        .where('utp.user_id = :userId', { userId: userIdStr })
        .andWhere('td.task_type = :type', { type })
        .andWhere('utp.cycle_end <= :now', { now })
        .getMany();

      for (const userTask of tasksToRefresh) {
        const cycleDates = this.getCycleDates(userTask.task_definition.task_type);
        userTask.status = TaskStatus.PENDING;
        userTask.progress_json = this.initializeTaskProgress(
          userTask.task_definition.requirement_json,
        );
        userTask.completed_at = null;
        userTask.claimed_at = null;
        userTask.cycle_start = cycleDates.start;
        userTask.cycle_end = cycleDates.end;
      }

      if (tasksToRefresh.length > 0) {
        await this.userTaskProgressRepository.save(tasksToRefresh);
        this.logger.log(
          `Refreshed ${tasksToRefresh.length} ${type} tasks for user ${userId}`,
        );
      }

      return;
    }

    // 刷新所有过期任务
    const expiredTasks = await this.userTaskProgressRepository
      .createQueryBuilder('utp')
      .innerJoinAndSelect('utp.task_definition', 'td')
      .where('utp.user_id = :userId', { userId: userIdStr })
      .andWhere('utp.cycle_end <= :now', { now })
      .getMany();

    for (const userTask of expiredTasks) {
      const cycleDates = this.getCycleDates(userTask.task_definition.task_type);
      userTask.status = TaskStatus.PENDING;
      userTask.progress_json = this.initializeTaskProgress(
        userTask.task_definition.requirement_json,
      );
      userTask.completed_at = null;
      userTask.claimed_at = null;
      userTask.cycle_start = cycleDates.start;
      userTask.cycle_end = cycleDates.end;
    }

    if (expiredTasks.length > 0) {
      await this.userTaskProgressRepository.save(expiredTasks);
      this.logger.log(
        `Refreshed ${expiredTasks.length} expired tasks for user ${userId}`,
      );
    }
  }

  // ============================================================
  // 6. 统计
  // ============================================================

  /**
   * 获取用户任务统计
   *
   * @param userId - 用户ID
   * @returns 任务统计信息
   */
  async getTaskStats(userId: number): Promise<{
    dailyTotal: number;
    dailyCompleted: number;
    dailyClaimed: number;
    weeklyTotal: number;
    weeklyCompleted: number;
    weeklyClaimed: number;
  }> {
    const userIdStr = String(userId);
    const now = new Date();

    const allTasks = await this.userTaskProgressRepository
      .createQueryBuilder('utp')
      .innerJoinAndSelect('utp.task_definition', 'td')
      .where('utp.user_id = :userId', { userId: userIdStr })
      .andWhere('utp.cycle_end > :now', { now })
      .getMany();

    let dailyTotal = 0;
    let dailyCompleted = 0;
    let dailyClaimed = 0;
    let weeklyTotal = 0;
    let weeklyCompleted = 0;
    let weeklyClaimed = 0;

    for (const task of allTasks) {
      if (task.task_definition.task_type === TaskType.DAILY) {
        dailyTotal++;
        if (task.status === TaskStatus.COMPLETED) dailyCompleted++;
        if (task.status === TaskStatus.CLAIMED) {
          dailyCompleted++;
          dailyClaimed++;
        }
      } else {
        weeklyTotal++;
        if (task.status === TaskStatus.COMPLETED) weeklyCompleted++;
        if (task.status === TaskStatus.CLAIMED) {
          weeklyCompleted++;
          weeklyClaimed++;
        }
      }
    }

    return {
      dailyTotal,
      dailyCompleted,
      dailyClaimed,
      weeklyTotal,
      weeklyCompleted,
      weeklyClaimed,
    };
  }
}

// ---- 辅助函数 ----

function InArray(values: string[]) {
  return { $in: values } as any;
}
