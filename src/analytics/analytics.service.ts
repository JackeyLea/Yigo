import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan, MoreThanOrEqual } from 'typeorm';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import {
  AnalyticsEvent,
  EventType,
  RetentionCohort,
  CohortType,
  UserLtv,
  DailyStats,
} from './entities';

export interface RetentionData {
  cohortDate: string;
  day0: number;
  day1: number;
  day3: number;
  day7: number;
  day14: number;
  day30: number;
}

export interface HourlyStats {
  hour: number;
  count: number;
  avgDuration: number;
}

export interface ConversionStats {
  totalVisitors: number;
  registeredUsers: number;
  firstPurchaseUsers: number;
  repeatPurchaseUsers: number;
  registrationRate: number;
  firstPurchaseRate: number;
  repeatPurchaseRate: number;
  overallConversionRate: number;
}

export interface FunnelData {
  steps: string[];
  stepData: Array<{
    step: string;
    count: number;
    conversionRate: number; // vs previous step
    dropOffRate: number;
  }>;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface DashboardStats {
  totalUsers: number;
  dau: number;
  mau: number;
  newUsersToday: number;
  activeRooms: number;
  gamesPlayedToday: number;
  avgSessionDuration: number;
  revenueToday: number;
  arpu: number;
  retentionD1: number;
  retentionD7: number;
  topGame: string;
  conversionRate: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(AnalyticsEvent)
    private readonly eventRepository: Repository<AnalyticsEvent>,
    @InjectRepository(RetentionCohort)
    private readonly cohortRepository: Repository<RetentionCohort>,
    @InjectRepository(UserLtv)
    private readonly ltvRepository: Repository<UserLtv>,
    @InjectRepository(DailyStats)
    private readonly dailyStatsRepository: Repository<DailyStats>,
    @InjectRedis()
    private readonly redis: Redis,
  ) {}

  // ===== 事件追踪 =====

  /**
   * 记录用户行为事件
   * 使用Redis Stream做实时事件流，每日批量写入PostgreSQL
   */
  async trackEvent(
    userId: number,
    eventType: string,
    eventData?: Record<string, any>,
    metadata?: { gameType?: string; sessionId?: number; ipAddress?: string; country?: string },
  ): Promise<void> {
    const timestamp = Date.now();
    const event = {
      userId: userId.toString(),
      eventType,
      eventData: JSON.stringify(eventData || {}),
      gameType: metadata?.gameType || '',
      sessionId: metadata?.sessionId?.toString() || '0',
      ipAddress: metadata?.ipAddress || '',
      country: metadata?.country || '',
      timestamp: timestamp.toString(),
    };

    // 写入Redis Stream（实时事件流）
    await this.redis.xadd(
      'analytics:events',
      '*',
      ...Object.entries(event).flat(),
    );

    // 更新HyperLogLog统计（DAU）
    const today = new Date().toISOString().split('T')[0];
    await this.redis.pfadd(`dau:${today}`, userId.toString());

    // 更新MAU
    const month = today.substring(0, 7); // YYYY-MM
    await this.redis.pfadd(`mau:${month}`, userId.toString());

    // 更新实时计数器
    await this.redis.hincrby(`stats:${today}`, eventType, 1);

    // 处理特殊事件类型
    await this.handleSpecialEvents(userId, eventType, eventData);
  }

  /**
   * 批量刷新事件到PostgreSQL
   * 从Redis Stream读取并写入DB
   */
  async flushEventsToDatabase(): Promise<number> {
    const events: any[] = [];
    let count = 0;

    // 从Stream中读取事件（每次最多1000条）
    const streamData = await this.redis.xread(
      'COUNT', 1000,
      'STREAMS', 'analytics:events', '0',
    );

    if (!streamData || streamData.length === 0) {
      return 0;
    }

    for (const [, messages] of streamData) {
      for (const [messageId, fields] of messages) {
        const eventMap = this.parseStreamFields(fields);
        events.push({
          userId: parseInt(eventMap.userId),
          eventType: eventMap.eventType,
          eventData: eventMap.eventData ? JSON.parse(eventMap.eventData) : null,
          gameType: eventMap.gameType || null,
          sessionId: parseInt(eventMap.sessionId || '0') || null,
          ipAddress: eventMap.ipAddress || null,
          country: eventMap.country || null,
          createdAt: new Date(parseInt(eventMap.timestamp)),
        });

        // 删除已处理的消息
        await this.redis.xdel('analytics:events', messageId);
        count++;
      }
    }

    if (events.length > 0) {
      // 批量插入
      await this.eventRepository
        .createQueryBuilder()
        .insert()
        .into(AnalyticsEvent)
        .values(events)
        .execute();

      this.logger.log(`Flushed ${events.length} events to database`);
    }

    return count;
  }

  // ===== DAU/MAU =====

  /**
   * 获取DAU（日活跃用户）
   * 使用Redis HyperLogLog（误差约0.81%）
   */
  async getActiveUsers(date: Date, period: 'daily' | 'monthly'): Promise<number> {
    if (period === 'daily') {
      const dateKey = date.toISOString().split('T')[0];
      // 先查Redis HyperLogLog
      const dau = await this.redis.pfcount(`dau:${dateKey}`);
      if (dau > 0) {
        return dau;
      }
      // Fallback: 从数据库查
      return this.getDauFromDb(date);
    } else {
      const monthKey = date.toISOString().split('T')[0].substring(0, 7);
      const mau = await this.redis.pfcount(`mau:${monthKey}`);
      if (mau > 0) {
        return mau;
      }
      return this.getMauFromDb(date);
    }
  }

  // ===== 留存率 =====

  /**
   * 获取留存率统计
   * Cohort分析：取某一天的新用户作为群体，追踪后续每天的回流比例
   */
  async getRetentionStats(
    startDate: Date,
    endDate: Date,
    cohortType: 'daily' | 'weekly' | 'monthly',
  ): Promise<RetentionData[]> {
    // 先查已有的cohort数据
    const cohorts = await this.cohortRepository.find({
      where: {
        cohortDate: Between(startDate, endDate),
        cohortType: cohortType as CohortType,
      },
      order: { cohortDate: 'DESC' },
    });

    if (cohorts.length > 0) {
      return cohorts.map((c) => ({
        cohortDate: c.cohortDate.toISOString().split('T')[0],
        day0: parseFloat(c.day0Rate.toString()),
        day1: parseFloat(c.day1Rate.toString()),
        day3: parseFloat(c.day3Rate.toString()),
        day7: parseFloat(c.day7Rate.toString()),
        day14: parseFloat(c.day14Rate.toString()),
        day30: parseFloat(c.day30Rate.toString()),
      }));
    }

    // 如果没有预计算数据，实时计算
    return this.calculateRetentionRealtime(startDate, endDate, cohortType);
  }

  /**
   * 计算留存率（实时）
   */
  private async calculateRetentionRealtime(
    startDate: Date,
    endDate: Date,
    cohortType: 'daily' | 'weekly' | 'monthly',
  ): Promise<RetentionData[]> {
    // 获取指定日期范围内的新注册用户
    const newUsers = await this.eventRepository
      .createQueryBuilder('e')
      .select(['e.userId', 'e.createdAt'])
      .where('e.eventType = :type', { type: EventType.REGISTER })
      .andWhere('e.createdAt BETWEEN :start AND :end', { start: startDate, end: endDate })
      .getMany();

    // 按日期分组用户
    const userGroups = new Map<string, number[]>();
    for (const user of newUsers) {
      const dateKey = this.getCohortDateKey(user.createdAt, cohortType);
      if (!userGroups.has(dateKey)) {
        userGroups.set(dateKey, []);
      }
      userGroups.get(dateKey)!.push(user.userId);
    }

    const result: RetentionData[] = [];

    for (const [dateKey, userIds] of userGroups) {
      const totalUsers = userIds.length;
      if (totalUsers === 0) continue;

      // 查询各日期的活跃用户
      const cohortDate = new Date(dateKey);
      const day0Active = await this.countActiveUsersOnDay(userIds, cohortDate);
      const day1Active = await this.countActiveUsersOnDay(userIds, this.addDays(cohortDate, 1));
      const day3Active = await this.countActiveUsersOnDay(userIds, this.addDays(cohortDate, 3));
      const day7Active = await this.countActiveUsersOnDay(userIds, this.addDays(cohortDate, 7));
      const day14Active = await this.countActiveUsersOnDay(userIds, this.addDays(cohortDate, 14));
      const day30Active = await this.countActiveUsersOnDay(userIds, this.addDays(cohortDate, 30));

      result.push({
        cohortDate: dateKey,
        day0: this.toRate(day0Active, totalUsers),
        day1: this.toRate(day1Active, totalUsers),
        day3: this.toRate(day3Active, totalUsers),
        day7: this.toRate(day7Active, totalUsers),
        day14: this.toRate(day14Active, totalUsers),
        day30: this.toRate(day30Active, totalUsers),
      });
    }

    return result.sort((a, b) => b.cohortDate.localeCompare(a.cohortDate));
  }

  /**
   * 计算并保存留存cohort（定时任务调用）
   */
  async computeRetentionCohorts(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];

    // 获取该日新注册用户
    const dayStart = new Date(dateStr);
    const dayEnd = this.addDays(dayStart, 1);

    const newUsers = await this.eventRepository
      .createQueryBuilder('e')
      .select('DISTINCT e.userId', 'userId')
      .where('e.eventType = :type', { type: EventType.REGISTER })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .getRawMany();

    const userIds = newUsers.map((u) => u.userId);
    const totalUsers = userIds.length;

    if (totalUsers === 0) return;

    // 计算各日留存
    const day0Active = totalUsers; // 当天注册当天算活跃
    const day1Active = await this.countActiveUsersOnDay(userIds, this.addDays(date, 1));
    const day3Active = await this.countActiveUsersOnDay(userIds, this.addDays(date, 3));
    const day7Active = await this.countActiveUsersOnDay(userIds, this.addDays(date, 7));
    const day14Active = await this.countActiveUsersOnDay(userIds, this.addDays(date, 14));
    const day30Active = await this.countActiveUsersOnDay(userIds, this.addDays(date, 30));

    // 保存或更新cohort记录
    let cohort = await this.cohortRepository.findOne({
      where: { cohortDate: dayStart, cohortType: CohortType.DAILY },
    });

    if (!cohort) {
      cohort = this.cohortRepository.create({
        cohortDate: dayStart,
        cohortType: CohortType.DAILY,
        totalUsers,
      });
    }

    cohort.day0Active = day0Active;
    cohort.day0Rate = this.toRate(day0Active, totalUsers);
    cohort.day1Active = day1Active;
    cohort.day1Rate = this.toRate(day1Active, totalUsers);
    cohort.day3Active = day3Active;
    cohort.day3Rate = this.toRate(day3Active, totalUsers);
    cohort.day7Active = day7Active;
    cohort.day7Rate = this.toRate(day7Active, totalUsers);
    cohort.day14Active = day14Active;
    cohort.day14Rate = this.toRate(day14Active, totalUsers);
    cohort.day30Active = day30Active;
    cohort.day30Rate = this.toRate(day30Active, totalUsers);

    // 如果30天数据都有了，标记为完成
    const now = new Date();
    if (this.addDays(dayStart, 30) <= now) {
      cohort.isComplete = true;
    }

    await this.cohortRepository.save(cohort);
    this.logger.log(`Computed retention cohort for ${dateStr}: ${totalUsers} users`);
  }

  // ===== 用户生命周期价值 =====

  /**
   * 获取用户生命周期价值（LTV）
   */
  async getUserLTV(userId: number): Promise<number> {
    // 先查缓存
    const cached = await this.redis.hget(`ltv:${userId}`, 'value');
    if (cached) {
      return parseFloat(cached);
    }

    // 查数据库
    const ltv = await this.ltvRepository.findOne({ where: { userId } });
    if (ltv) {
      // 缓存结果
      await this.redis.hset(`ltv:${userId}`, {
        value: ltv.totalSpent.toString(),
        games: ltv.totalGamesPlayed.toString(),
      });
      await this.redis.expire(`ltv:${userId}`, 3600); // 1小时过期
      return parseFloat(ltv.totalSpent.toString());
    }

    // 实时计算
    const totalSpent = await this.calculateUserLTV(userId);
    return totalSpent;
  }

  /**
   * 实时计算用户LTV
   */
  private async calculateUserLTV(userId: number): Promise<number> {
    const purchases = await this.eventRepository
      .createQueryBuilder('e')
      .select('COALESCE(SUM(CAST(e.eventData->>$.amount AS DECIMAL)), 0)', 'total')
      .where('e.userId = :userId', { userId })
      .andWhere('e.eventType = :type', { type: EventType.PURCHASE })
      .getRawOne();

    const total = parseFloat(purchases?.total || '0');

    // 缓存结果
    await this.redis.hset(`ltv:${userId}`, { value: total.toString() });
    await this.redis.expire(`ltv:${userId}`, 3600);

    return total;
  }

  /**
   * 更新用户LTV（购买事件触发）
   */
  async updateUserLTV(userId: number, amount: number): Promise<void> {
    let ltv = await this.ltvRepository.findOne({ where: { userId } });

    if (!ltv) {
      ltv = this.ltvRepository.create({
        userId,
        totalSpent: 0,
        purchaseCount: 0,
        avgPurchaseValue: 0,
        firstPurchaseAt: new Date(),
      });
    }

    ltv.totalSpent = parseFloat(ltv.totalSpent.toString()) + amount;
    ltv.purchaseCount += 1;
    ltv.avgPurchaseValue = parseFloat(ltv.totalSpent.toString()) / ltv.purchaseCount;
    ltv.lastPurchaseAt = new Date();
    ltv.daysSinceLastPurchase = 0;

    // 计算距首次购买天数
    if (ltv.firstPurchaseAt) {
      const diffMs = Date.now() - ltv.firstPurchaseAt.getTime();
      ltv.daysSinceFirstPurchase = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    await this.ltvRepository.save(ltv);

    // 更新缓存
    await this.redis.hincrbyfloat(`ltv:${userId}`, 'value', amount);
  }

  // ===== 游戏热度分析 =====

  /**
   * 获取游戏热度分析（按小时分布）
   */
  async getGameHeatmap(gameType: string, date: Date): Promise<HourlyStats[]> {
    const dateStr = date.toISOString().split('T')[0];
    const dayStart = new Date(dateStr);
    const dayEnd = this.addDays(dayStart, 1);

    // 从数据库查询
    const events = await this.eventRepository
      .createQueryBuilder('e')
      .select('HOUR(e.createdAt)', 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('e.eventType = :type', { type: EventType.GAME_START })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .andWhere(gameType ? 'e.gameType = :gameType' : '1=1', { gameType })
      .groupBy('HOUR(e.createdAt)')
      .orderBy('hour', 'ASC')
      .getRawMany();

    // 补充没有数据的时段
    const hourlyMap = new Map<number, { count: number; avgDuration: number }>();
    for (const e of events) {
      hourlyMap.set(parseInt(e.hour), { count: parseInt(e.count), avgDuration: 0 });
    }

    // 计算平均对局时长
    const durations = await this.eventRepository
      .createQueryBuilder('e')
      .select('HOUR(e.createdAt)', 'hour')
      .addSelect('AVG(CAST(e.eventData->>$.duration AS DECIMAL))', 'avgDuration')
      .where('e.eventType = :type', { type: EventType.GAME_END })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .andWhere(gameType ? 'e.gameType = :gameType' : '1=1', { gameType })
      .groupBy('HOUR(e.createdAt)')
      .getRawMany();

    for (const d of durations) {
      const hour = parseInt(d.hour);
      const existing = hourlyMap.get(hour) || { count: 0, avgDuration: 0 };
      existing.avgDuration = parseFloat(d.avgDuration || '0');
      hourlyMap.set(hour, existing);
    }

    // 构造24小时完整数据
    const result: HourlyStats[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const data = hourlyMap.get(hour) || { count: 0, avgDuration: 0 };
      result.push({ hour, count: data.count, avgDuration: Math.round(data.avgDuration) });
    }

    return result;
  }

  // ===== 付费转化率 =====

  /**
   * 获取付费转化率
   */
  async getConversionRate(startDate: Date, endDate: Date): Promise<ConversionStats> {
    // 访客数（登录用户去重）
    const visitors = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.createdAt BETWEEN :start AND :end', { start: startDate, end: endDate })
      .getRawOne();

    // 注册用户数
    const registered = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.eventType = :type', { type: EventType.REGISTER })
      .andWhere('e.createdAt BETWEEN :start AND :end', { start: startDate, end: endDate })
      .getRawOne();

    // 首次付费用户
    const firstPurchase = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.eventType = :type', { type: EventType.PURCHASE })
      .andWhere('e.createdAt BETWEEN :start AND :end', { start: startDate, end: endDate })
      .getRawOne();

    // 复购用户（购买2次以上）
    const repeatPurchase = await this.eventRepository
      .createQueryBuilder('e')
      .select('e.userId', 'userId')
      .addSelect('COUNT(*)', 'purchaseCount')
      .where('e.eventType = :type', { type: EventType.PURCHASE })
      .andWhere('e.createdAt BETWEEN :start AND :end', { start: startDate, end: endDate })
      .groupBy('e.userId')
      .having('COUNT(*) >= 2')
      .getRawMany();

    const totalVisitors = parseInt(visitors?.count || '0');
    const registeredUsers = parseInt(registered?.count || '0');
    const firstPurchaseUsers = parseInt(firstPurchase?.count || '0');
    const repeatPurchaseUsers = repeatPurchase.length;

    return {
      totalVisitors,
      registeredUsers,
      firstPurchaseUsers,
      repeatPurchaseUsers,
      registrationRate: totalVisitors > 0 ? parseFloat(((registeredUsers / totalVisitors) * 100).toFixed(2)) : 0,
      firstPurchaseRate: registeredUsers > 0 ? parseFloat(((firstPurchaseUsers / registeredUsers) * 100).toFixed(2)) : 0,
      repeatPurchaseRate: firstPurchaseUsers > 0 ? parseFloat(((repeatPurchaseUsers / firstPurchaseUsers) * 100).toFixed(2)) : 0,
      overallConversionRate: totalVisitors > 0 ? parseFloat(((firstPurchaseUsers / totalVisitors) * 100).toFixed(2)) : 0,
    };
  }

  // ===== 用户行为漏斗 =====

  /**
   * 获取用户行为漏斗分析
   */
  async getFunnelAnalysis(funnelSteps: string[], dateRange: DateRange): Promise<FunnelData> {
    const stepData = [];
    let previousCount: number | null = null;

    for (const step of funnelSteps) {
      const count = await this.getFunnelStepCount(step, dateRange);

      let conversionRate = 100;
      let dropOffRate = 0;

      if (previousCount !== null && previousCount > 0) {
        conversionRate = parseFloat(((count / previousCount) * 100).toFixed(2));
        dropOffRate = parseFloat((100 - conversionRate).toFixed(2));
      }

      stepData.push({
        step,
        count,
        conversionRate,
        dropOffRate,
      });

      previousCount = count;
    }

    return { steps: funnelSteps, stepData };
  }

  /**
   * 获取漏斗某一步的用户数
   */
  private async getFunnelStepCount(step: string, dateRange: DateRange): Promise<number> {
    // step可以是eventType，也可以是复合条件
    const eventType = this.mapStepToEventType(step);

    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.eventType = :type', { type: eventType })
      .andWhere('e.createdAt BETWEEN :start AND :end', {
        start: dateRange.start,
        end: dateRange.end,
      })
      .getRawOne();

    return parseInt(result?.count || '0');
  }

  // ===== 仪表盘数据 =====

  /**
   * 获取运营后台仪表盘数据
   */
  async getDashboardStats(): Promise<DashboardStats> {
    const now = new Date();
    const today = new Date(now.toISOString().split('T')[0]);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 并行查询各项数据
    const [
      dau,
      mau,
      newUsersToday,
      gamesPlayedToday,
      revenueToday,
      totalUsers,
      retentionD1,
      retentionD7,
      conversionRate,
      topGame,
    ] = await Promise.all([
      this.getActiveUsers(today, 'daily'),
      this.getActiveUsers(now, 'monthly'),
      this.getNewUsersToday(today),
      this.getGamesPlayedToday(today),
      this.getRevenueToday(today),
      this.getTotalUsers(),
      this.getLatestRetentionD1(),
      this.getLatestRetentionD7(),
      this.getTodayConversionRate(today),
      this.getTopGameToday(today),
    ]);

    // 从daily_stats表获取（如果有）
    const dailyStats = await this.dailyStatsRepository.findOne({
      where: { date: today },
    });

    const avgSessionDuration = dailyStats?.avgSessionDuration
      ? parseFloat(dailyStats.avgSessionDuration.toString())
      : await this.getAvgSessionDuration(today);

    const activeRooms = dailyStats?.activeRooms || 0;

    // ARPU = 收入 / DAU
    const arpu = dau > 0 ? parseFloat((revenueToday / dau).toFixed(2)) : 0;

    return {
      totalUsers,
      dau,
      mau,
      newUsersToday,
      activeRooms,
      gamesPlayedToday,
      avgSessionDuration: Math.round(avgSessionDuration),
      revenueToday: Math.round(revenueToday * 100) / 100,
      arpu,
      retentionD1,
      retentionD7,
      topGame: topGame || 'chess',
      conversionRate,
    };
  }

  /**
   * 计算每日统计数据（定时任务调用）
   */
  async computeDailyStats(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    const dayStart = new Date(dateStr);
    const dayEnd = this.addDays(dayStart, 1);

    // DAU
    const dau = await this.getDauFromDb(dayStart);

    // 新用户
    const newUsers = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.eventType = :type', { type: EventType.REGISTER })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .getRawOne();

    // 总用户数
    const totalUsers = await this.getTotalUsers();

    // 游戏局数
    const gamesPlayed = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(*)', 'count')
      .where('e.eventType = :type', { type: EventType.GAME_START })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .getRawOne();

    // 收入
    const revenue = await this.eventRepository
      .createQueryBuilder('e')
      .select('COALESCE(SUM(CAST(e.eventData->>$.amount AS DECIMAL)), 0)', 'total')
      .where('e.eventType = :type', { type: EventType.PURCHASE })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .getRawOne();

    // 平均会话时长
    const sessions = await this.eventRepository
      .createQueryBuilder('e')
      .select('AVG(CAST(e.eventData->>$.duration AS DECIMAL))', 'avg')
      .where('e.eventType = :type', { type: EventType.GAME_END })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .getRawOne();

    // 付费用户数
    const paidUsers = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.eventType = :type', { type: EventType.PURCHASE })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .getRawOne();

    // 热门游戏
    const topGame = await this.eventRepository
      .createQueryBuilder('e')
      .select('e.gameType', 'gameType')
      .addSelect('COUNT(*)', 'count')
      .where('e.eventType = :type', { type: EventType.GAME_START })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .groupBy('e.gameType')
      .orderBy('count', 'DESC')
      .limit(1)
      .getRawOne();

    // 游戏类型分布
    const gameDist = await this.eventRepository
      .createQueryBuilder('e')
      .select('e.gameType', 'gameType')
      .addSelect('COUNT(*)', 'count')
      .where('e.eventType = :type', { type: EventType.GAME_START })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .groupBy('e.gameType')
      .getRawMany();

    const gameTypeDistribution: Record<string, number> = {};
    for (const g of gameDist) {
      if (g.gameType) {
        gameTypeDistribution[g.gameType] = parseInt(g.count);
      }
    }

    let stats = await this.dailyStatsRepository.findOne({ where: { date: dayStart } });
    if (!stats) {
      stats = this.dailyStatsRepository.create({ date: dayStart });
    }

    stats.dau = dau;
    stats.newUsers = parseInt(newUsers?.count || '0');
    stats.totalUsers = totalUsers;
    stats.gamesPlayed = parseInt(gamesPlayed?.count || '0');
    stats.revenue = parseFloat(revenue?.total || '0');
    stats.avgSessionDuration = parseFloat(sessions?.avg || '0');
    stats.paidUsers = parseInt(paidUsers?.count || '0');
    stats.purchaseCount = parseInt(paidUsers?.count || '0');
    stats.topGame = topGame?.gameType || null;
    stats.gameTypeDistribution = gameTypeDistribution;

    await this.dailyStatsRepository.save(stats);
    this.logger.log(`Computed daily stats for ${dateStr}: DAU=${dau}, Revenue=${stats.revenue}`);
  }

  // ===== 内部辅助方法 =====

  /**
   * 处理特殊事件类型
   */
  private async handleSpecialEvents(
    userId: number,
    eventType: string,
    eventData?: Record<string, any>,
  ): Promise<void> {
    switch (eventType) {
      case EventType.PURCHASE:
        if (eventData?.amount) {
          await this.updateUserLTV(userId, parseFloat(eventData.amount));
        }
        break;
      case EventType.GAME_END:
        if (eventData?.duration) {
          await this.redis.hincrby(`user:${userId}:games`, 'count', 1);
          await this.redis.hincrby(`user:${userId}:games`, 'totalMinutes', Math.round(parseFloat(eventData.duration) / 60));
        }
        break;
      case EventType.INVITE:
        await this.redis.hincrby(`user:${userId}:invites`, 'count', 1);
        break;
    }
  }

  /**
   * 解析Redis Stream字段
   */
  private parseStreamFields(fields: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      result[fields[i]] = fields[i + 1];
    }
    return result;
  }

  /**
   * 获取Cohort日期Key
   */
  private getCohortDateKey(date: Date, type: 'daily' | 'weekly' | 'monthly'): string {
    const d = new Date(date);
    if (type === 'daily') {
      return d.toISOString().split('T')[0];
    } else if (type === 'weekly') {
      const dayOfWeek = d.getDay();
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - dayOfWeek);
      return weekStart.toISOString().split('T')[0];
    } else {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }
  }

  /**
   * 计算指定日期活跃用户中有多少属于指定用户群
   */
  private async countActiveUsersOnDay(userIds: number[], date: Date): Promise<number> {
    if (userIds.length === 0) return 0;

    const dateStr = date.toISOString().split('T')[0];
    const dayStart = new Date(dateStr);
    const dayEnd = this.addDays(dayStart, 1);

    // 分批查询避免IN子句过大
    const batchSize = 1000;
    let totalActive = 0;

    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const result = await this.eventRepository
        .createQueryBuilder('e')
        .select('COUNT(DISTINCT e.userId)', 'count')
        .where('e.userId IN (:...userIds)', { userIds: batch })
        .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
        .getRawOne();

      totalActive += parseInt(result?.count || '0');
    }

    return totalActive;
  }

  /**
   * 转换为百分比
   */
  private toRate(numerator: number, denominator: number): number {
    if (denominator === 0) return 0;
    return parseFloat(((numerator / denominator) * 100).toFixed(2));
  }

  /**
   * 日期加减天数
   */
  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * 从数据库查询DAU
   */
  private async getDauFromDb(date: Date): Promise<number> {
    const dateStr = date.toISOString().split('T')[0];
    const dayStart = new Date(dateStr);
    const dayEnd = this.addDays(dayStart, 1);

    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.createdAt >= :start AND e.createdAt < :end', { start: dayStart, end: dayEnd })
      .getRawOne();

    return parseInt(result?.count || '0');
  }

  /**
   * 从数据库查询MAU
   */
  private async getMauFromDb(date: Date): Promise<number> {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);

    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.createdAt >= :start AND e.createdAt < :end', { start: monthStart, end: monthEnd })
      .getRawOne();

    return parseInt(result?.count || '0');
  }

  /**
   * 获取今日新用户
   */
  private async getNewUsersToday(today: Date): Promise<number> {
    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.eventType = :type', { type: EventType.REGISTER })
      .andWhere('e.createdAt >= :start', { start: today })
      .getRawOne();

    return parseInt(result?.count || '0');
  }

  /**
   * 获取今日游戏局数
   */
  private async getGamesPlayedToday(today: Date): Promise<number> {
    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(*)', 'count')
      .where('e.eventType = :type', { type: EventType.GAME_START })
      .andWhere('e.createdAt >= :start', { start: today })
      .getRawOne();

    return parseInt(result?.count || '0');
  }

  /**
   * 获取今日收入
   */
  private async getRevenueToday(today: Date): Promise<number> {
    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('COALESCE(SUM(CAST(e.eventData->>$.amount AS DECIMAL)), 0)', 'total')
      .where('e.eventType = :type', { type: EventType.PURCHASE })
      .andWhere('e.createdAt >= :start', { start: today })
      .getRawOne();

    return parseFloat(result?.total || '0');
  }

  /**
   * 获取总用户数
   */
  private async getTotalUsers(): Promise<number> {
    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.eventType = :type', { type: EventType.REGISTER })
      .getRawOne();

    return parseInt(result?.count || '0');
  }

  /**
   * 获取最新次日留存
   */
  private async getLatestRetentionD1(): Promise<number> {
    const cohort = await this.cohortRepository.findOne({
      where: { cohortType: CohortType.DAILY },
      order: { cohortDate: 'DESC' },
    });

    return cohort ? parseFloat(cohort.day1Rate.toString()) : 0;
  }

  /**
   * 获取最新7日留存
   */
  private async getLatestRetentionD7(): Promise<number> {
    const cohort = await this.cohortRepository.findOne({
      where: { cohortType: CohortType.DAILY },
      order: { cohortDate: 'DESC' },
    });

    return cohort ? parseFloat(cohort.day7Rate.toString()) : 0;
  }

  /**
   * 获取今日转化率
   */
  private async getTodayConversionRate(today: Date): Promise<number> {
    const visitors = await this.getDauFromDb(today);
    const purchasers = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.eventType = :type', { type: EventType.PURCHASE })
      .andWhere('e.createdAt >= :start', { start: today })
      .getRawOne();

    const purchaseCount = parseInt(purchasers?.count || '0');
    return visitors > 0 ? parseFloat(((purchaseCount / visitors) * 100).toFixed(2)) : 0;
  }

  /**
   * 获取今日热门游戏
   */
  private async getTopGameToday(today: Date): Promise<string | null> {
    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('e.gameType', 'gameType')
      .addSelect('COUNT(*)', 'count')
      .where('e.eventType = :type', { type: EventType.GAME_START })
      .andWhere('e.createdAt >= :start', { start: today })
      .groupBy('e.gameType')
      .orderBy('count', 'DESC')
      .limit(1)
      .getRawOne();

    return result?.gameType || null;
  }

  /**
   * 获取平均会话时长
   */
  private async getAvgSessionDuration(today: Date): Promise<number> {
    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('AVG(CAST(e.eventData->>$.duration AS DECIMAL))', 'avg')
      .where('e.eventType = :type', { type: EventType.GAME_END })
      .andWhere('e.createdAt >= :start', { start: today })
      .getRawOne();

    return parseFloat(result?.avg || '0');
  }

  /**
   * 映射漏斗步骤到事件类型
   */
  private mapStepToEventType(step: string): EventType {
    const map: Record<string, EventType> = {
      'register': EventType.REGISTER,
      'login': EventType.LOGIN,
      'tutorial': EventType.TUTORIAL_COMPLETE,
      'game_start': EventType.GAME_START,
      'game_end': EventType.GAME_END,
      'purchase': EventType.PURCHASE,
      'share': EventType.SHARE,
      'invite': EventType.INVITE,
      'club_join': EventType.CLUB_JOIN,
      'room_join': EventType.ROOM_JOIN,
    };
    return map[step] || (step as EventType);
  }
}
