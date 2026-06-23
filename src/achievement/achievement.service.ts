/**
 * AchievementService - 成就业务逻辑层
 *
 * 负责处理成就的查询、解锁检查、奖励领取、进度追踪等功能。
 * 支持基于事件驱动的成就解锁机制，通过DSL条件解析实现灵活的成就配置。
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

import { Achievement, AchievementCategory } from '../common/entities/achievement.entity';
import { UserAchievement } from '../common/entities/user-achievement.entity';
import { User } from '../common/entities/user.entity';
import { Wallet } from '../common/entities/wallet.entity';
import { Transaction, TransactionType } from '../common/entities/transaction.entity';

import {
  GameEvent,
  Reward,
  AchievementProgress,
  UnlockedAchievement,
  UnlockCheckResult,
} from './interfaces';

@Injectable()
export class AchievementService {
  private readonly logger = new Logger(AchievementService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(Achievement)
    private readonly achievementRepository: Repository<Achievement>,
    @InjectRepository(UserAchievement)
    private readonly userAchievementRepository: Repository<UserAchievement>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
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
  }

  // ============================================================
  // 1. 成就查询
  // ============================================================

  /**
   * 获取成就列表
   *
   * 根据用户ID和游戏类型筛选可显示的成就。
   * 如果提供了userId，会额外标记每个成就的解锁状态。
   *
   * @param userId - 用户ID（可选，用于获取解锁状态）
   * @param gameType - 游戏类型筛选（可选）
   * @returns 成就列表
   */
  async getAchievements(
    userId?: number,
    gameType?: string,
  ): Promise<Achievement[]> {
    const qb = this.achievementRepository.createQueryBuilder('achievement');

    // 只查询非隐藏的成就（或者用户已解锁的隐藏成就需要在其他地方处理）
    qb.where('achievement.is_hidden = :isHidden', { isHidden: false });

    // 按游戏类型筛选
    if (gameType) {
      qb.andWhere(
        '(achievement.game_type = :gameType OR achievement.game_type IS NULL)',
        { gameType },
      );
    }

    // 跨游戏成就始终显示
    qb.orWhere('achievement.category = :crossGame', {
      crossGame: AchievementCategory.CROSS_GAME,
    });

    const achievements = await qb
      .orderBy('achievement.category', 'ASC')
      .addOrderBy('achievement.created_at', 'ASC')
      .getMany();

    // 如果提供了用户ID，获取该用户的解锁状态并附加到成就上
    if (userId !== undefined) {
      const userAchievements = await this.getUserAchievements(userId);
      const unlockedMap = new Map(
        userAchievements.map((ua) => [ua.achievement_id, ua]),
      );

      // 为每个成就附加用户进度信息（通过扩展属性）
      for (const achievement of achievements) {
        const userAchievement = unlockedMap.get(achievement.achievement_id);
        (achievement as any).userProgress = userAchievement
          ? {
              isUnlocked: !!userAchievement.unlocked_at,
              isClaimed: userAchievement.is_claimed,
              unlockedAt: userAchievement.unlocked_at,
              progress: userAchievement.progress_json,
            }
          : {
              isUnlocked: false,
              isClaimed: false,
              unlockedAt: null,
              progress: {},
            };
      }
    }

    return achievements;
  }

  /**
   * 获取用户已解锁的成就列表
   *
   * @param userId - 用户ID
   * @returns 用户成就列表（包含已解锁和进行中的）
   */
  async getUserAchievements(userId: number): Promise<UserAchievement[]> {
    return this.userAchievementRepository.find({
      where: { user_id: String(userId) },
      relations: ['achievement'],
      order: { unlocked_at: 'DESC' },
    });
  }

  /**
   * 获取用户新解锁但未领取奖励的成就
   *
   * @param userId - 用户ID
   * @returns 未领取奖励的已解锁成就列表
   */
  async getUnclaimedAchievements(userId: number): Promise<UserAchievement[]> {
    return this.userAchievementRepository.find({
      where: {
        user_id: String(userId),
        unlocked_at: NotNull(),
        is_claimed: false,
      },
      relations: ['achievement'],
    });
  }

  // ============================================================
  // 2. 成就解锁检查
  // ============================================================

  /**
   * 检查并解锁成就
   *
   * 根据游戏事件检查用户是否满足成就解锁条件，
   * 如果满足则自动解锁成就。支持批量解锁。
   *
   * @param userId - 用户ID
   * @param event - 游戏事件
   * @returns 新解锁的成就列表
   */
  async checkAndUnlock(
    userId: number,
    event: GameEvent,
  ): Promise<UnlockedAchievement[]> {
    this.logger.debug(
      `Checking achievements for user ${userId}, event: ${event.type}`,
    );

    // 1. 获取所有相关成就定义
    const relevantAchievements = await this.getRelevantAchievements(event);

    if (relevantAchievements.length === 0) {
      return [];
    }

    // 2. 获取用户当前的成就进度
    const userAchievements = await this.getOrCreateUserAchievements(
      userId,
      relevantAchievements,
    );

    // 3. 评估每个成就的解锁条件
    const newlyUnlocked: UnlockedAchievement[] = [];

    for (const achievement of relevantAchievements) {
      const userAchievement = userAchievements.find(
        (ua) => ua.achievement_id === achievement.achievement_id,
      );

      if (!userAchievement || userAchievement.unlocked_at) {
        // 已解锁的跳过
        continue;
      }

      // 评估解锁条件
      const checkResult = this.evaluateUnlockCondition(
        achievement.unlock_condition_json,
        userAchievement.progress_json,
        event,
      );

      if (checkResult.shouldUnlock) {
        // 更新进度并解锁
        userAchievement.progress_json = checkResult.updatedProgress;
        userAchievement.unlocked_at = new Date();
        await this.userAchievementRepository.save(userAchievement);

        newlyUnlocked.push({
          achievementId: achievement.achievement_id,
          achievementCode: achievement.achievement_code,
          name: achievement.name,
          description: achievement.description,
          unlockedAt: userAchievement.unlocked_at,
          isNew: true,
        });

        this.logger.log(
          `User ${userId} unlocked achievement: ${achievement.name} (${achievement.achievement_code})`,
        );
      } else {
        // 只更新进度
        userAchievement.progress_json = checkResult.updatedProgress;
        await this.userAchievementRepository.save(userAchievement);
      }
    }

    // 4. 发送通知（通过Redis Pub/Sub）
    if (newlyUnlocked.length > 0) {
      await this.notifyUnlock(userId, newlyUnlocked);
    }

    return newlyUnlocked;
  }

  /**
   * 获取与事件相关的成就列表
   *
   * 根据事件类型筛选可能相关的成就定义
   *
   * @param event - 游戏事件
   * @returns 相关成就列表
   */
  private async getRelevantAchievements(
    event: GameEvent,
  ): Promise<Achievement[]> {
    const qb = this.achievementRepository.createQueryBuilder('achievement');

    // 基础条件：成就必须启用（非隐藏或通过特定事件触发）
    qb.where('1=1');

    // 根据事件类型添加筛选条件
    switch (event.type) {
      case 'game_won':
        qb.andWhere(
          `(achievement.unlock_condition_json->>'eventType' = 'game_won' 
           OR achievement.unlock_condition_json->>'eventType' = 'game_played'
           OR achievement.category = :crossGame)`,
          { crossGame: AchievementCategory.CROSS_GAME },
        );
        if (event.gameType) {
          qb.andWhere(
            `(achievement.game_type = :gameType OR achievement.game_type IS NULL)`,
            { gameType: event.gameType },
          );
        }
        break;

      case 'game_played':
        qb.andWhere(
          `(achievement.unlock_condition_json->>'eventType' = 'game_played'
           OR achievement.unlock_condition_json->>'eventType' = 'game_won'
           OR achievement.category = :crossGame)`,
          { crossGame: AchievementCategory.CROSS_GAME },
        );
        if (event.gameType) {
          qb.andWhere(
            `(achievement.game_type = :gameType OR achievement.game_type IS NULL)`,
            { gameType: event.gameType },
          );
        }
        break;

      case 'streak':
        qb.andWhere(
          `achievement.unlock_condition_json->>'eventType' = 'streak'`,
        );
        break;

      case 'special_move':
        qb.andWhere(
          `achievement.unlock_condition_json->>'eventType' = 'special_move'`,
        );
        if (event.gameType) {
          qb.andWhere(
            `(achievement.game_type = :gameType OR achievement.game_type IS NULL)`,
            { gameType: event.gameType },
          );
        }
        break;

      case 'social':
        qb.andWhere(
          `achievement.unlock_condition_json->>'eventType' = 'social'`,
        );
        break;

      case 'login':
        qb.andWhere(
          `achievement.unlock_condition_json->>'eventType' = 'login'`,
        );
        break;

      default:
        break;
    }

    return qb.getMany();
  }

  /**
   * 获取或创建用户成就记录
   *
   * 确保用户对所有相关成就都有进度记录
   *
   * @param userId - 用户ID
   * @param achievements - 成就定义列表
   * @returns 用户成就列表
   */
  private async getOrCreateUserAchievements(
    userId: number,
    achievements: Achievement[],
  ): Promise<UserAchievement[]> {
    const userIdStr = String(userId);
    const achievementIds = achievements.map((a) => a.achievement_id);

    // 查询现有的用户成就记录
    const existingUserAchievements = await this.userAchievementRepository.find({
      where: {
        user_id: userIdStr,
        achievement_id: InArray(achievementIds),
      },
    });

    const existingIds = new Set(
      existingUserAchievements.map((ua) => ua.achievement_id),
    );

    // 为缺失的成就创建新记录
    const newUserAchievements: UserAchievement[] = [];
    for (const achievement of achievements) {
      if (!existingIds.has(achievement.achievement_id)) {
        const newUa = this.userAchievementRepository.create({
          user_id: userIdStr,
          achievement_id: achievement.achievement_id,
          progress_json: this.initializeProgress(achievement.unlock_condition_json),
          is_claimed: false,
        });
        newUserAchievements.push(newUa);
      }
    }

    if (newUserAchievements.length > 0) {
      await this.userAchievementRepository.save(newUserAchievements);
    }

    // 返回所有用户成就记录（重新查询以包含新创建的）
    return this.userAchievementRepository.find({
      where: {
        user_id: userIdStr,
        achievement_id: InArray(achievementIds),
      },
    });
  }

  /**
   * 初始化成就进度
   *
   * 根据解锁条件创建初始进度对象
   *
   * @param condition - 解锁条件
   * @returns 初始进度对象
   */
  private initializeProgress(condition: Record<string, any>): Record<string, any> {
    const progress: Record<string, any> = {};

    const eventType = condition.eventType || condition.type;

    switch (eventType) {
      case 'game_won':
        progress.totalWins = 0;
        progress.winsByGameType = {};
        progress.winsByPluginId = {};
        break;
      case 'game_played':
        progress.totalGamesPlayed = 0;
        progress.gamesByGameType = {};
        break;
      case 'streak':
        progress.currentStreak = 0;
        progress.maxStreak = 0;
        break;
      case 'special_move':
        progress.movesByType = {};
        progress.totalSpecialMoves = 0;
        break;
      case 'social':
        progress.totalActions = 0;
        progress.actionsByType = {};
        break;
      case 'login':
        progress.consecutiveDays = 0;
        progress.totalDays = 0;
        progress.lastLoginDate = null;
        break;
      default:
        break;
    }

    return progress;
  }

  /**
   * 评估解锁条件
   *
   * 根据事件和当前进度判断是否满足解锁条件
   *
   * @param condition - 解锁条件定义
   * @param currentProgress - 当前进度
   * @param event - 游戏事件
   * @returns 解锁检查结果
   */
  private evaluateUnlockCondition(
    condition: Record<string, any>,
    currentProgress: Record<string, any>,
    event: GameEvent,
  ): UnlockCheckResult {
    const progress = { ...currentProgress };
    const eventType = condition.eventType || condition.type;

    // 如果事件类型不匹配，直接返回
    if (event.type !== eventType) {
      return { shouldUnlock: false, updatedProgress: progress };
    }

    let shouldUnlock = false;

    switch (event.type) {
      case 'game_won':
        shouldUnlock = this.evaluateGameWon(condition, progress, event);
        break;
      case 'game_played':
        shouldUnlock = this.evaluateGamePlayed(condition, progress, event);
        break;
      case 'streak':
        shouldUnlock = this.evaluateStreak(condition, progress, event);
        break;
      case 'special_move':
        shouldUnlock = this.evaluateSpecialMove(condition, progress, event);
        break;
      case 'social':
        shouldUnlock = this.evaluateSocial(condition, progress, event);
        break;
      case 'login':
        shouldUnlock = this.evaluateLogin(condition, progress, event);
        break;
    }

    return { shouldUnlock, updatedProgress: progress };
  }

  // ----- 各类型成就的评估逻辑 -----

  private evaluateGameWon(
    condition: Record<string, any>,
    progress: Record<string, any>,
    event: { type: 'game_won'; gameType: string; pluginId: string; mode: string },
  ): boolean {
    // 更新胜利次数
    progress.totalWins = (progress.totalWins || 0) + 1;

    // 按游戏类型统计
    if (!progress.winsByGameType) progress.winsByGameType = {};
    progress.winsByGameType[event.gameType] =
      (progress.winsByGameType[event.gameType] || 0) + 1;

    // 按插件统计
    if (!progress.winsByPluginId) progress.winsByPluginId = {};
    progress.winsByPluginId[event.pluginId] =
      (progress.winsByPluginId[event.pluginId] || 0) + 1;

    // 检查条件
    const requiredWins = condition.count || 1;

    // 特定游戏类型的胜利
    if (condition.gameType) {
      if (condition.gameType === event.gameType) {
        const wins = progress.winsByGameType[event.gameType] || 0;
        return wins >= requiredWins;
      }
      return false;
    }

    // 特定模式
    if (condition.mode && condition.mode !== event.mode) {
      return false;
    }

    // 全能王：在所有指定游戏中都赢过
    if (condition.requireAllGameTypes) {
      const requiredGameTypes: string[] = condition.requireAllGameTypes;
      const wins = progress.winsByGameType || {};
      return requiredGameTypes.every((gt) => (wins[gt] || 0) >= (condition.perGameCount || 1));
    }

    // 普通累计胜利
    return progress.totalWins >= requiredWins;
  }

  private evaluateGamePlayed(
    condition: Record<string, any>,
    progress: Record<string, any>,
    event: { type: 'game_played'; gameType: string; count: number },
  ): boolean {
    // 更新游戏次数
    const addedCount = event.count || 1;
    progress.totalGamesPlayed = (progress.totalGamesPlayed || 0) + addedCount;

    // 按游戏类型统计
    if (!progress.gamesByGameType) progress.gamesByGameType = {};
    progress.gamesByGameType[event.gameType] =
      (progress.gamesByGameType[event.gameType] || 0) + addedCount;

    // 检查条件
    const requiredCount = condition.count || 1;

    if (condition.gameType) {
      return (progress.gamesByGameType[condition.gameType] || 0) >= requiredCount;
    }

    return progress.totalGamesPlayed >= requiredCount;
  }

  private evaluateStreak(
    condition: Record<string, any>,
    progress: Record<string, any>,
    event: { type: 'streak'; count: number },
  ): boolean {
    // 更新连胜记录
    progress.currentStreak = event.count;
    if (event.count > (progress.maxStreak || 0)) {
      progress.maxStreak = event.count;
    }

    // 检查条件
    const requiredStreak = condition.count || 1;
    return progress.currentStreak >= requiredStreak;
  }

  private evaluateSpecialMove(
    condition: Record<string, any>,
    progress: Record<string, any>,
    event: { type: 'special_move'; gameType: string; moveType: string },
  ): boolean {
    // 更新特殊移动次数
    if (!progress.movesByType) progress.movesByType = {};
    progress.movesByType[event.moveType] =
      (progress.movesByType[event.moveType] || 0) + 1;
    progress.totalSpecialMoves = (progress.totalSpecialMoves || 0) + 1;

    // 检查条件
    const requiredCount = condition.count || 1;

    if (condition.moveType) {
      return (progress.movesByType[condition.moveType] || 0) >= requiredCount;
    }

    return progress.totalSpecialMoves >= requiredCount;
  }

  private evaluateSocial(
    condition: Record<string, any>,
    progress: Record<string, any>,
    event: { type: 'social'; action: string; count: number },
  ): boolean {
    // 更新社交行为次数
    const addedCount = event.count || 1;
    if (!progress.actionsByType) progress.actionsByType = {};
    progress.actionsByType[event.action] =
      (progress.actionsByType[event.action] || 0) + addedCount;
    progress.totalActions = (progress.totalActions || 0) + addedCount;

    // 检查条件
    const requiredCount = condition.count || 1;

    if (condition.action) {
      return (progress.actionsByType[condition.action] || 0) >= requiredCount;
    }

    return progress.totalActions >= requiredCount;
  }

  private evaluateLogin(
    condition: Record<string, any>,
    progress: Record<string, any>,
    event: { type: 'login'; consecutiveDays: number },
  ): boolean {
    // 更新登录记录
    progress.consecutiveDays = event.consecutiveDays;
    progress.totalDays = (progress.totalDays || 0) + 1;
    progress.lastLoginDate = new Date().toISOString();

    // 检查条件
    const requiredDays = condition.consecutiveDays || condition.count || 1;
    return progress.consecutiveDays >= requiredDays;
  }

  // ============================================================
  // 3. 奖励领取
  // ============================================================

  /**
   * 领取成就奖励
   *
   * 用户解锁成就后，可以领取对应的奖励。
   * 支持货币、经验值、称号等类型的奖励。
   *
   * @param userId - 用户ID
   * @param achievementId - 成就ID
   * @returns 领取的奖励信息
   */
  async claimReward(userId: number, achievementId: number): Promise<Reward> {
    const userIdStr = String(userId);
    const achievementIdStr = String(achievementId);

    // 1. 查找用户成就记录
    const userAchievement = await this.userAchievementRepository.findOne({
      where: {
        user_id: userIdStr,
        achievement_id: achievementIdStr,
      },
      relations: ['achievement'],
    });

    if (!userAchievement) {
      throw new NotFoundException(
        `用户成就记录不存在: userId=${userId}, achievementId=${achievementId}`,
      );
    }

    if (!userAchievement.unlocked_at) {
      throw new BadRequestException('成就尚未解锁，无法领取奖励');
    }

    if (userAchievement.is_claimed) {
      throw new BadRequestException('奖励已领取');
    }

    // 2. 解析奖励配置
    const rewardConfig = userAchievement.achievement.reward_json;
    const reward = await this.processReward(
      userIdStr,
      rewardConfig,
      userAchievement.achievement,
    );

    // 3. 标记为已领取
    userAchievement.is_claimed = true;
    await this.userAchievementRepository.save(userAchievement);

    this.logger.log(
      `User ${userId} claimed reward for achievement: ${userAchievement.achievement.name}`,
    );

    return reward;
  }

  /**
   * 处理奖励发放
   *
   * 根据奖励配置执行实际的发放逻辑
   *
   * @param userIdStr - 用户ID字符串
   * @param rewardConfig - 奖励配置
   * @param achievement - 成就定义
   * @returns 奖励信息
   */
  private async processReward(
    userIdStr: string,
    rewardConfig: Record<string, any>,
    achievement: Achievement,
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
          await this.grantCurrencyReward(queryRunner, userIdStr, currency, Number(rewardValue));
          break;

        case 'xp':
          await this.grantXpReward(queryRunner, userIdStr, Number(rewardValue));
          break;

        case 'title':
          // 称号奖励存储在Redis中
          await this.grantTitleReward(userIdStr, String(rewardValue));
          break;

        case 'item':
        case 'badge':
          // 物品和徽章也存储在Redis中
          await this.grantItemReward(userIdStr, String(rewardValue), rewardType);
          break;

        default:
          this.logger.warn(`Unknown reward type: ${rewardType}`);
      }

      await queryRunner.commitTransaction();

      return {
        achievementId: achievement.achievement_id,
        achievementName: achievement.name,
        rewardType,
        rewardValue,
        currency: rewardType === 'currency' ? currency : undefined,
        claimedAt: new Date(),
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to process reward: ${error.message}`, error.stack);
      throw new BadRequestException('奖励发放失败');
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 发放货币奖励
   */
  private async grantCurrencyReward(
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
      reference_type: 'achievement_reward',
    });
    await txRepo.save(tx);
  }

  /**
   * 发放经验值奖励
   */
  private async grantXpReward(
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

    // 简单的等级计算：每1000 XP升一级
    const newLevel = Math.floor(Number(newXp) / 1000) + 1;
    if (newLevel > user.level) {
      user.level = newLevel;
      this.logger.log(`User ${userIdStr} leveled up to ${newLevel}`);
    }

    await manager.save(User, user);
  }

  /**
   * 发放称号奖励
   */
  private async grantTitleReward(
    userIdStr: string,
    title: string,
  ): Promise<void> {
    const key = `user:${userIdStr}:titles`;
    try {
      await this.redis.sadd(key, title);
    } catch (error) {
      this.logger.warn(`Failed to grant title: ${error.message}`);
    }
  }

  /**
   * 发放物品/徽章奖励
   */
  private async grantItemReward(
    userIdStr: string,
    itemId: string,
    itemType: string,
  ): Promise<void> {
    const key = `user:${userIdStr}:${itemType}s`;
    try {
      await this.redis.sadd(key, itemId);
    } catch (error) {
      this.logger.warn(`Failed to grant ${itemType}: ${error.message}`);
    }
  }

  // ============================================================
  // 4. 进度查询
  // ============================================================

  /**
   * 获取成就进度
   *
   * @param userId - 用户ID
   * @param achievementId - 成就ID
   * @returns 成就进度信息
   */
  async getProgress(
    userId: number,
    achievementId: number,
  ): Promise<AchievementProgress> {
    const userIdStr = String(userId);
    const achievementIdStr = String(achievementId);

    // 查询成就定义
    const achievement = await this.achievementRepository.findOne({
      where: { achievement_id: achievementIdStr },
    });

    if (!achievement) {
      throw new NotFoundException(`成就不存在: ${achievementId}`);
    }

    // 查询用户成就记录
    let userAchievement = await this.userAchievementRepository.findOne({
      where: {
        user_id: userIdStr,
        achievement_id: achievementIdStr,
      },
    });

    if (!userAchievement) {
      // 创建新的进度记录
      userAchievement = this.userAchievementRepository.create({
        user_id: userIdStr,
        achievement_id: achievementIdStr,
        progress_json: this.initializeProgress(achievement.unlock_condition_json),
        is_claimed: false,
      });
      await this.userAchievementRepository.save(userAchievement);
    }

    // 计算进度百分比
    const progress = userAchievement.progress_json;
    const condition = achievement.unlock_condition_json;
    const { current, target } = this.calculateProgressMetrics(progress, condition);
    const percentage = target > 0 ? Math.min(100, Math.floor((current / target) * 100)) : 0;

    return {
      achievementId: achievement.achievement_id,
      achievementCode: achievement.achievement_code,
      name: achievement.name,
      description: achievement.description,
      currentProgress: current,
      targetProgress: target,
      percentage,
      isUnlocked: !!userAchievement.unlocked_at,
      unlockedAt: userAchievement.unlocked_at || undefined,
      isClaimed: userAchievement.is_claimed,
      isHidden: achievement.is_hidden,
    };
  }

  /**
   * 计算进度指标
   *
   * @param progress - 当前进度
   * @param condition - 解锁条件
   * @returns 当前值和目标值
   */
  private calculateProgressMetrics(
    progress: Record<string, any>,
    condition: Record<string, any>,
  ): { current: number; target: number } {
    const eventType = condition.eventType || condition.type;

    switch (eventType) {
      case 'game_won':
        if (condition.requireAllGameTypes) {
          // 全能王类型：计算已完成的游戏类型数
          const requiredTypes: string[] = condition.requireAllGameTypes;
          const wins = progress.winsByGameType || {};
          const perGameCount = condition.perGameCount || 1;
          const completed = requiredTypes.filter(
            (gt) => (wins[gt] || 0) >= perGameCount,
          ).length;
          return { current: completed, target: requiredTypes.length };
        }
        return {
          current: progress.totalWins || 0,
          target: condition.count || 1,
        };

      case 'game_played':
        return {
          current: progress.totalGamesPlayed || 0,
          target: condition.count || 1,
        };

      case 'streak':
        return {
          current: progress.maxStreak || 0,
          target: condition.count || 1,
        };

      case 'special_move':
        return {
          current: progress.totalSpecialMoves || 0,
          target: condition.count || 1,
        };

      case 'social':
        return {
          current: progress.totalActions || 0,
          target: condition.count || 1,
        };

      case 'login':
        return {
          current: progress.consecutiveDays || 0,
          target: condition.consecutiveDays || condition.count || 1,
        };

      default:
        return { current: 0, target: 1 };
    }
  }

  // ============================================================
  // 5. 通知
  // ============================================================

  /**
   * 发送成就解锁通知
   *
   * 通过Redis Pub/Sub发送通知，供网关层推送
   *
   * @param userId - 用户ID
   * @param unlockedAchievements - 新解锁的成就列表
   */
  private async notifyUnlock(
    userId: number,
    unlockedAchievements: UnlockedAchievement[],
  ): Promise<void> {
    try {
      const channel = `notifications:user:${userId}`;
      const message = JSON.stringify({
        type: 'achievement_unlocked',
        data: unlockedAchievements,
        timestamp: new Date().toISOString(),
      });
      await this.redis.publish(channel, message);
    } catch (error) {
      this.logger.warn(`Failed to send unlock notification: ${error.message}`);
    }
  }

  // ============================================================
  // 6. 批量操作
  // ============================================================

  /**
   * 初始化用户的所有成就记录
   *
   * 新用户注册时调用，为所有成就创建初始进度记录
   *
   * @param userId - 用户ID
   */
  async initializeUserAchievements(userId: number): Promise<void> {
    const userIdStr = String(userId);

    // 获取所有成就定义
    const allAchievements = await this.achievementRepository.find();

    // 检查用户已有的记录
    const existingRecords = await this.userAchievementRepository.find({
      where: { user_id: userIdStr },
    });
    const existingIds = new Set(existingRecords.map((r) => r.achievement_id));

    // 创建缺失的记录
    const newRecords: UserAchievement[] = [];
    for (const achievement of allAchievements) {
      if (!existingIds.has(achievement.achievement_id)) {
        newRecords.push(
          this.userAchievementRepository.create({
            user_id: userIdStr,
            achievement_id: achievement.achievement_id,
            progress_json: this.initializeProgress(
              achievement.unlock_condition_json,
            ),
            is_claimed: false,
          }),
        );
      }
    }

    if (newRecords.length > 0) {
      await this.userAchievementRepository.save(newRecords);
      this.logger.log(
        `Initialized ${newRecords.length} achievement records for user ${userId}`,
      );
    }
  }

  /**
   * 获取成就统计
   *
   * @param userId - 用户ID
   * @returns 成就统计信息
   */
  async getAchievementStats(userId: number): Promise<{
    totalAchievements: number;
    unlockedCount: number;
    claimedCount: number;
    totalRewards: number;
  }> {
    const userIdStr = String(userId);

    const [totalAchievements, userAchievements] = await Promise.all([
      this.achievementRepository.count(),
      this.userAchievementRepository.find({
        where: { user_id: userIdStr },
        relations: ['achievement'],
      }),
    ]);

    const unlockedCount = userAchievements.filter((ua) => !!ua.unlocked_at).length;
    const claimedCount = userAchievements.filter((ua) => ua.is_claimed).length;

    // 计算总奖励价值
    let totalRewards = 0;
    for (const ua of userAchievements) {
      if (ua.is_claimed && ua.achievement) {
        const reward = ua.achievement.reward_json;
        if (reward.type === 'currency' || reward.type === 'xp') {
          totalRewards += Number(reward.value || 0);
        }
      }
    }

    return {
      totalAchievements,
      unlockedCount,
      claimedCount,
      totalRewards,
    };
  }
}

// ---- 辅助函数 ----

function NotNull() {
  // TypeORM查询非空辅助
  return { $not: null } as any;
}

function InArray(values: string[]) {
  // TypeORM查询IN辅助
  return { $in: values } as any;
}
