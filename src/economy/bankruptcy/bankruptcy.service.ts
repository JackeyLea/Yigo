import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserBalance } from '../common/entities';
import { BANKRUPTCY, REDIS_KEYS } from '../common/constants';

export interface ReliefStatus {
  canClaim: boolean;
  reason?: string;
  claimCount: number;
  maxClaims: number;
  nextClaimTime?: Date;
  nextResetTime: Date;
}

export interface ReliefResult {
  amount: number;
  totalClaims: number;
  remainingClaims: number;
  balanceAfter: number;
}

@Injectable()
export class BankruptcyService {
  constructor(
    @InjectRepository(UserBalance)
    private readonly balanceRepo: Repository<UserBalance>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  /**
   * 检查用户是否可以领取破产补助
   */
  async canClaimRelief(userId: number): Promise<ReliefStatus> {
    const [claimCount, lastClaimTime, balance] = await Promise.all([
      this.getTodayClaimCount(userId),
      this.getLastClaimTime(userId),
      this.getUserBalance(userId),
    ]);

    const maxClaims = await this.getMaxDailyClaims(userId);
    const now = new Date();
    const nextResetTime = this.getNextResetTime();

    // 检查余额是否低于门槛
    if (balance >= BANKRUPTCY.MIN_BALANCE_THRESHOLD) {
      return {
        canClaim: false,
        reason: `金币余额(${balance})未达到破产条件(需低于${BANKRUPTCY.MIN_BALANCE_THRESHOLD})`,
        claimCount,
        maxClaims,
        nextResetTime,
      };
    }

    // 检查今日领取次数
    if (claimCount >= maxClaims) {
      return {
        canClaim: false,
        reason: `今日已领取${claimCount}次补助，已达上限(${maxClaims}次)，请明日再来`,
        claimCount,
        maxClaims,
        nextResetTime,
      };
    }

    // 检查冷却时间
    if (lastClaimTime) {
      const cooldownEnd = new Date(lastClaimTime.getTime() + BANKRUPTCY.CLAIM_COOLDOWN_SECONDS * 1000);
      if (now < cooldownEnd) {
        return {
          canClaim: false,
          reason: `领取过于频繁，请稍后再试`,
          claimCount,
          maxClaims,
          nextClaimTime: cooldownEnd,
          nextResetTime,
        };
      }
    }

    return {
      canClaim: true,
      claimCount,
      maxClaims,
      nextResetTime,
    };
  }

  /**
   * 领取破产补助
   */
  async claimRelief(userId: number): Promise<ReliefResult> {
    const status = await this.canClaimRelief(userId);
    if (!status.canClaim) {
      throw new Error(status.reason || '暂不可领取破产补助');
    }

    // 使用Redis原子递增领取次数
    const claimKey = REDIS_KEYS.BANKRUPTCY_CLAIM_COUNT(userId);
    const totalClaims = await this.redis.incr(claimKey);

    // 设置TTL到次日4点（如果是第一次设置）
    const ttl = await this.redis.ttl(claimKey);
    if (ttl === -1) {
      const nextReset = this.getNextResetTime();
      const ttlSeconds = Math.floor((nextReset.getTime() - Date.now()) / 1000);
      await this.redis.expire(claimKey, ttlSeconds);
    }

    // 记录最后领取时间
    await this.redis.set(
      REDIS_KEYS.BANKRUPTCY_LAST_CLAIM(userId),
      Date.now().toString(),
      'EX',
      BANKRUPTCY.CLAIM_COOLDOWN_SECONDS,
    );

    // 增加金币
    const amount = BANKRUPTCY.RELIEF_AMOUNT;
    const balanceAfter = await this.addCoins(userId, amount);

    const maxClaims = await this.getMaxDailyClaims(userId);

    return {
      amount,
      totalClaims,
      remainingClaims: Math.max(0, maxClaims - totalClaims),
      balanceAfter,
    };
  }

  /**
   * 获取今日已领取次数
   */
  async getTodayClaimCount(userId: number): Promise<number> {
    const count = await this.redis.get(REDIS_KEYS.BANKRUPTCY_CLAIM_COUNT(userId));
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * 获取用户VIP等级（用于计算额外次数）
   */
  private async getUserVipLevel(userId: number): Promise<number> {
    const vipLevel = await this.redis.get(REDIS_KEYS.VIP_LEVEL(userId));
    return vipLevel ? parseInt(vipLevel, 10) : 0;
  }

  /**
   * 获取每日最大领取次数（基础次数 + VIP加成）
   */
  async getMaxDailyClaims(userId: number): Promise<number> {
    const vipLevel = await this.getUserVipLevel(userId);
    let extraClaims = 0;

    // VIP2及以上增加1次
    if (vipLevel >= 2) {
      extraClaims = 1;
    }

    return BANKRUPTCY.MAX_DAILY_CLAIMS + extraClaims;
  }

  /**
   * 获取下次重置时间（次日4点）
   */
  private getNextResetTime(): Date {
    const now = new Date();
    const reset = new Date(now.getFullYear(), now.getMonth(), now.getDate(), BANKRUPTCY.DAILY_RESET_HOUR, 0, 0);
    if (now >= reset) {
      reset.setDate(reset.getDate() + 1);
    }
    return reset;
  }

  /**
   * 获取上次领取时间
   */
  private async getLastClaimTime(userId: number): Promise<Date | null> {
    const timestamp = await this.redis.get(REDIS_KEYS.BANKRUPTCY_LAST_CLAIM(userId));
    return timestamp ? new Date(parseInt(timestamp, 10)) : null;
  }

  /**
   * 获取用户余额
   */
  private async getUserBalance(userId: number): Promise<number> {
    const balance = await this.balanceRepo.findOne({ where: { userId } });
    return balance ? Number(balance.coins) : 0;
  }

  /**
   * 增加用户金币
   */
  private async addCoins(userId: number, amount: number): Promise<number> {
    await this.balanceRepo.increment({ userId }, 'coins', amount);
    await this.balanceRepo.increment({ userId }, 'totalEarned', amount);
    const updated = await this.balanceRepo.findOne({ where: { userId } });
    return updated ? Number(updated.coins) : 0;
  }
}
