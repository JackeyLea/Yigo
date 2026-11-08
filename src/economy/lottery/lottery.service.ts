import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserBalance } from '../common/entities';
import { LOTTERY, REDIS_KEYS } from '../common/constants';

export interface WheelPrize {
  id: string;
  name: string;
  type: 'coins' | 'item' | 'vip_day' | 'avatar_frame' | 'title';
  value: number;
  weight: number;
  icon: string;
}

export interface WheelConfig {
  slots: WheelPrize[];
  freeSpinsPerDay: number;
  coinCostPerSpin: number;
  jackpotAmount: number;
  jackpotGuarantee: number;
}

export interface SpinResult {
  prize: WheelPrize;
  isJackpot: boolean;
  balanceAfter: number;
  spinCount: number;
  isFreeSpin: boolean;
}

@Injectable()
export class LotteryService {
  private readonly prizes: WheelPrize[];
  private readonly totalWeight: number;

  constructor(
    @InjectRepository(UserBalance)
    private readonly balanceRepo: Repository<UserBalance>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {
    this.prizes = [...LOTTERY.DEFAULT_PRIZES];
    this.totalWeight = this.prizes.reduce((sum, p) => sum + p.weight, 0);
  }

  /**
   * 获取转盘配置
   */
  async getWheelConfig(): Promise<WheelConfig> {
    return {
      slots: this.prizes,
      freeSpinsPerDay: LOTTERY.FREE_SPIN_DAILY,
      coinCostPerSpin: LOTTERY.COIN_COST_PER_SPIN,
      jackpotAmount: LOTTERY.JACKPOT_AMOUNT,
      jackpotGuarantee: LOTTERY.JACKPOT_GUARANTEE,
    };
  }

  /**
   * 抽奖（自动检测免费/付费）
   */
  async spin(userId: number): Promise<SpinResult> {
    const freeSpins = await this.getFreeSpins(userId);
    const isFreeSpin = freeSpins > 0;

    if (!isFreeSpin) {
      // 检查余额是否足够
      const balance = await this.getUserBalance(userId);
      if (balance < LOTTERY.COIN_COST_PER_SPIN) {
        throw new Error(`金币不足，抽奖需要${LOTTERY.COIN_COST_PER_SPIN}金币`);
      }
    }

    return this.performSpin(userId, isFreeSpin);
  }

  /**
   * 使用金币抽奖
   */
  async spinWithCoins(userId: number, cost: number = LOTTERY.COIN_COST_PER_SPIN): Promise<SpinResult> {
    const balance = await this.getUserBalance(userId);
    if (balance < cost) {
      throw new Error(`金币不足，需要${cost}金币`);
    }

    return this.performSpin(userId, false, cost);
  }

  /**
   * 获取今日免费次数
   */
  async getFreeSpins(userId: number): Promise<number> {
    const usedKey = REDIS_KEYS.LOTTERY_FREE_SPIN(userId);
    const used = await this.redis.get(usedKey);
    const usedCount = used ? parseInt(used, 10) : 0;

    // 获取用户VIP等级，计算额外免费次数
    const vipExtraSpins = await this.getVipExtraSpins(userId);
    const totalFreeSpins = LOTTERY.FREE_SPIN_DAILY + vipExtraSpins;

    return Math.max(0, totalFreeSpins - usedCount);
  }

  /**
   * 执行抽奖核心逻辑
   */
  private async performSpin(userId: number, isFreeSpin: boolean, cost: number = LOTTERY.COIN_COST_PER_SPIN): Promise<SpinResult> {
    // 1. 扣除费用或消耗免费次数
    if (isFreeSpin) {
      const usedKey = REDIS_KEYS.LOTTERY_FREE_SPIN(userId);
      await this.redis.incr(usedKey);
      const ttl = await this.redis.ttl(usedKey);
      if (ttl === -1) {
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 4, 0, 0);
        const ttlSeconds = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
        await this.redis.expire(usedKey, Math.max(1, ttlSeconds));
      }
    } else {
      await this.deductCoins(userId, cost);
    }

    // 2. 增加总抽奖计数
    const spinCount = await this.redis.incr(REDIS_KEYS.LOTTERY_TOTAL_SPINS(userId));

    // 3. 检查保底机制
    const jackpotCounter = await this.redis.incr(REDIS_KEYS.LOTTERY_JACKPOT_COUNTER(userId));
    let prize: WheelPrize;
    let isJackpot = false;

    if (jackpotCounter >= LOTTERY.JACKPOT_GUARANTEE) {
      // 触发保底大奖
      prize = this.prizes.find(p => p.value === LOTTERY.JACKPOT_AMOUNT && p.type === 'coins')!;
      isJackpot = true;
      await this.redis.del(REDIS_KEYS.LOTTERY_JACKPOT_COUNTER(userId));
    } else {
      // 正常加权随机
      prize = this.weightedRandom();

      // 如果中了5000金币大奖，重置保底计数器
      if (prize.value === LOTTERY.JACKPOT_AMOUNT && prize.type === 'coins') {
        isJackpot = true;
        await this.redis.del(REDIS_KEYS.LOTTERY_JACKPOT_COUNTER(userId));
      }
    }

    // 4. 发放奖励
    let balanceAfter = await this.getUserBalance(userId);
    if (prize.type === 'coins' && prize.value > 0) {
      balanceAfter = await this.addCoins(userId, prize.value);
    } else if (prize.type === 'vip_day') {
      // 发放VIP天数通过其他服务处理，这里记录事件
      await this.redis.publish('economy:vip:grant', JSON.stringify({ userId, days: prize.value }));
    }
    // item类型奖励通过事件通知其他系统处理

    return {
      prize,
      isJackpot,
      balanceAfter,
      spinCount,
      isFreeSpin,
    };
  }

  /**
   * 加权随机选择奖品
   */
  private weightedRandom(): WheelPrize {
    let random = Math.random() * this.totalWeight;
    for (const prize of this.prizes) {
      random -= prize.weight;
      if (random <= 0) {
        return prize;
      }
    }
    return this.prizes[this.prizes.length - 1];
  }

  /**
   * 获取VIP额外免费次数
   */
  private async getVipExtraSpins(userId: number): Promise<number> {
    const vipLevel = await this.redis.get(REDIS_KEYS.VIP_LEVEL(userId));
    const level = vipLevel ? parseInt(vipLevel, 10) : 0;

    // VIP2及以上额外2次免费抽奖
    if (level >= 2) {
      return 2;
    }
    return 0;
  }

  /**
   * 获取用户余额
   */
  private async getUserBalance(userId: number): Promise<number> {
    const balance = await this.balanceRepo.findOne({ where: { userId } });
    return balance ? Number(balance.coins) : 0;
  }

  /**
   * 扣除金币
   */
  private async deductCoins(userId: number, amount: number): Promise<void> {
    await this.balanceRepo.decrement({ userId }, 'coins', amount);
    await this.balanceRepo.increment({ userId }, 'totalSpent', amount);
  }

  /**
   * 增加金币
   */
  private async addCoins(userId: number, amount: number): Promise<number> {
    await this.balanceRepo.increment({ userId }, 'coins', amount);
    await this.balanceRepo.increment({ userId }, 'totalEarned', amount);
    const updated = await this.balanceRepo.findOne({ where: { userId } });
    return updated ? Number(updated.coins) : 0;
  }
}
