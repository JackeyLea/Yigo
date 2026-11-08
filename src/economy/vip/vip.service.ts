import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserBalance } from '../common/entities';
import { VIP, REDIS_KEYS } from '../common/constants';

export interface VipLevel {
  level: number;
  name: string;
  expireAt: Date | null;
  privileges: string[];
}

export interface VipPurchaseResult {
  level: number;
  name: string;
  expireAt: Date;
  price: number;
  balanceAfter: number;
}

export interface VipPrivilege {
  id: string;
  name: string;
  description: string;
  icon: string;
  levels: number[];
}

@Injectable()
export class VipService {
  private readonly privilegeDefinitions: VipPrivilege[];

  constructor(
    @InjectRepository(UserBalance)
    private readonly balanceRepo: Repository<UserBalance>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {
    // 特权定义
    this.privilegeDefinitions = [
      {
        id: 'signin_2x',
        name: '每日签到2倍金币',
        description: '每日签到获得的金币数量翻倍',
        icon: 'signin_2x.png',
        levels: [1, 2, 3, 4, 5, 6],
      },
      {
        id: 'avatar_frame_vip1',
        name: '专属头像框',
        description: '获得VIP专属头像框标识',
        icon: 'avatar_frame.png',
        levels: [1, 2, 3, 4, 5, 6],
      },
      {
        id: 'free_spin_2x',
        name: '每日免费抽奖+2次',
        description: '每日转盘抽奖额外增加2次免费机会',
        icon: 'free_spin.png',
        levels: [2, 3, 4, 5, 6],
      },
      {
        id: 'bankruptcy_plus1',
        name: '破产补助+1次',
        description: '每日破产补助额外增加1次领取机会',
        icon: 'bankruptcy_plus.png',
        levels: [2, 3, 4, 5, 6],
      },
      {
        id: 'exclusive_emote',
        name: '专属表情',
        description: '解锁VIP专属聊天表情',
        icon: 'emote.png',
        levels: [3, 4, 5, 6],
      },
      {
        id: 'exp_50',
        name: '经验加成50%',
        description: '获得经验值增加50%',
        icon: 'exp_50.png',
        levels: [3, 4, 5, 6],
      },
      {
        id: 'priority_match',
        name: '优先匹配',
        description: '游戏匹配时享受优先排队权',
        icon: 'priority.png',
        levels: [4, 5, 6],
      },
      {
        id: 'vip_room',
        name: 'VIP专属房间',
        description: '可进入VIP专属游戏房间',
        icon: 'vip_room.png',
        levels: [4, 5, 6],
      },
      {
        id: 'vip_support',
        name: '专属客服',
        description: '享受一对一专属客服服务',
        icon: 'support.png',
        levels: [5, 6],
      },
      {
        id: 'free_transfer',
        name: '转账免手续费',
        description: '金币转账免收手续费',
        icon: 'transfer.png',
        levels: [5, 6],
      },
      {
        id: 'all',
        name: '全部特权',
        description: '尊享所有VIP特权及至尊标识',
        icon: 'supreme.png',
        levels: [6],
      },
    ];
  }

  /**
   * 获取VIP等级信息
   */
  async getVipLevel(userId: number): Promise<VipLevel> {
    const [levelStr, expireStr] = await Promise.all([
      this.redis.get(REDIS_KEYS.VIP_LEVEL(userId)),
      this.redis.get(REDIS_KEYS.VIP_EXPIRE(userId)),
    ]);

    const level = levelStr ? parseInt(levelStr, 10) : 0;
    const expireAt = expireStr ? new Date(parseInt(expireStr, 10)) : null;

    // 检查是否过期
    if (expireAt && expireAt < new Date()) {
      // VIP已过期，降级为普通用户
      await this.redis.del(REDIS_KEYS.VIP_LEVEL(userId));
      await this.redis.del(REDIS_KEYS.VIP_EXPIRE(userId));
      return {
        level: 0,
        name: VIP.LEVELS[0].name,
        expireAt: null,
        privileges: [],
      };
    }

    const vipConfig = VIP.LEVELS[level] || VIP.LEVELS[0];
    const privileges = this.getPrivilegesForLevel(level);

    return {
      level,
      name: vipConfig.name,
      expireAt,
      privileges: privileges.map(p => p.id),
    };
  }

  /**
   * 购买VIP
   */
  async purchaseVip(userId: number, level: number, durationDays: number = VIP.DURATION_DAYS): Promise<VipPurchaseResult> {
    if (level < 1 || level > 6) {
      throw new Error('VIP等级必须在1-6之间');
    }

    const vipConfig = VIP.LEVELS[level];
    if (!vipConfig) {
      throw new Error('无效的VIP等级');
    }

    // 检查余额（价格单位：分 -> 转换为金币消耗，这里简化为直接扣金币）
    const price = vipConfig.price;
    const balance = await this.getUserBalance(userId);
    if (balance < price) {
      throw new Error(`余额不足，需要${price}金币购买${vipConfig.name}会员`);
    }

    // 扣除金币
    await this.deductCoins(userId, price);

    // 计算VIP过期时间
    const now = new Date();
    const currentExpireStr = await this.redis.get(REDIS_KEYS.VIP_EXPIRE(userId));
    let expireAt: Date;

    if (currentExpireStr) {
      const currentExpire = new Date(parseInt(currentExpireStr, 10));
      // 如果当前VIP未过期，在原有基础上延长
      expireAt = currentExpire > now ? currentExpire : now;
      expireAt.setDate(expireAt.getDate() + durationDays);
    } else {
      expireAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    }

    // 更新VIP等级和过期时间
    await this.redis.set(REDIS_KEYS.VIP_LEVEL(userId), level.toString());
    await this.redis.set(REDIS_KEYS.VIP_EXPIRE(userId), expireAt.getTime().toString());

    // 持久化到数据库
    await this.persistVipToDatabase(userId, level, expireAt);

    const balanceAfter = await this.getUserBalance(userId);

    return {
      level,
      name: vipConfig.name,
      expireAt,
      price,
      balanceAfter,
    };
  }

  /**
   * 检查VIP特权
   */
  async checkPrivilege(userId: number, privilege: string): Promise<boolean> {
    const vipLevel = await this.getVipLevel(userId);

    if (vipLevel.level === 0) return false;

    // 至尊会员拥有所有特权
    if (vipLevel.level === 6) return true;

    return vipLevel.privileges.includes(privilege);
  }

  /**
   * 获取所有VIP特权说明
   */
  getVipPrivileges(): VipPrivilege[] {
    return this.privilegeDefinitions;
  }

  /**
   * 获取指定等级的特权列表
   */
  private getPrivilegesForLevel(level: number): VipPrivilege[] {
    if (level === 6) {
      // 至尊拥有所有特权
      return this.privilegeDefinitions;
    }
    return this.privilegeDefinitions.filter(p => p.levels.includes(level));
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
   * 持久化VIP信息到数据库
   */
  private async persistVipToDatabase(userId: number, level: number, expireAt: Date): Promise<void> {
    // 这里假设有UserVipRecord表来记录VIP购买历史
    // 简化实现：通过Redis发布事件，由其他服务持久化
    await this.redis.publish('economy:vip:purchased', JSON.stringify({
      userId,
      level,
      expireAt: expireAt.toISOString(),
    }));
  }
}
