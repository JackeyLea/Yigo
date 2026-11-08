import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserBalance } from '../common/entities';
import { GIFTPACK, REDIS_KEYS } from '../common/constants';

export interface PackContent {
  type: 'coins' | 'item' | 'vip_day';
  itemId?: string;
  quantity: number;
}

export interface GiftPack {
  id: string;
  name: string;
  description: string;
  type: 'daily' | 'weekly' | 'newbie' | 'limited' | 'event';
  price: number;
  originalPrice: number;
  contents: PackContent[];
  limitPerUser?: number;
  availableFrom?: Date;
  availableUntil?: Date;
  bannerImage: string;
}

export interface PurchaseResult {
  packId: string;
  packName: string;
  price: number;
  contents: PackContent[];
  balanceAfter: number;
  isFree: boolean;
  purchaseCount: number;
}

@Injectable()
export class GiftpackService {
  private readonly packs: GiftPack[];

  constructor(
    @InjectRepository(UserBalance)
    private readonly balanceRepo: Repository<UserBalance>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {
    this.packs = GIFTPACK.PACKS.map((p) => ({
      ...p,
      contents: p.contents.map((c) => ({ ...c })),
    }));
  }

  /**
   * 获取可购买的礼包列表
   */
  async getAvailablePacks(userId: number): Promise<GiftPack[]> {
    const availablePacks: GiftPack[] = [];

    for (const pack of this.packs) {
      const isAvailable = await this.isPackAvailable(userId, pack);
      if (isAvailable) {
        availablePacks.push(pack);
      }
    }

    return availablePacks;
  }

  /**
   * 购买礼包
   */
  async purchasePack(userId: number, packId: string): Promise<PurchaseResult> {
    const pack = this.packs.find(p => p.id === packId);
    if (!pack) {
      throw new Error('礼包不存在');
    }

    // 检查是否可以购买
    const canPurchase = await this.checkPurchaseable(userId, packId);
    if (!canPurchase) {
      throw new Error('礼包暂不可购买');
    }

    // 检查价格（非免费礼包）
    if (pack.price > 0) {
      const balance = await this.getUserBalance(userId);
      if (balance < pack.price) {
        throw new Error(`余额不足，需要${pack.price}金币`);
      }
    }

    // 检查限购
    const purchaseCount = await this.getPurchaseCount(userId, packId);
    if (pack.limitPerUser && purchaseCount >= pack.limitPerUser) {
      throw new Error('已达到购买次数上限');
    }

    // 扣除金币（非免费礼包）
    if (pack.price > 0) {
      await this.deductCoins(userId, pack.price);
    }

    // 增加购买计数
    const newCount = await this.redis.incr(REDIS_KEYS.GIFTPACK_PURCHASED(userId, packId));

    // 发放礼包内容
    const balanceAfter = await this.grantPackContents(userId, pack);

    // 记录每日领取（每日礼包）
    if (pack.type === 'daily') {
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 4, 0, 0);
      const ttlSeconds = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
      await this.redis.set(REDIS_KEYS.GIFTPACK_DAILY_CLAIMED(userId, packId), '1', 'EX', ttlSeconds);
    }

    return {
      packId: pack.id,
      packName: pack.name,
      price: pack.price,
      contents: pack.contents,
      balanceAfter,
      isFree: pack.price === 0,
      purchaseCount: newCount,
    };
  }

  /**
   * 领取免费礼包
   */
  async claimFreePack(userId: number, packId: string): Promise<PurchaseResult> {
    const pack = this.packs.find(p => p.id === packId);
    if (!pack) {
      throw new Error('礼包不存在');
    }

    if (pack.price !== 0) {
      throw new Error('该礼包不是免费礼包');
    }

    // 检查是否可以领取
    const canClaim = await this.checkPurchaseable(userId, packId);
    if (!canClaim) {
      throw new Error('今日已领取，请明日再来');
    }

    // 增加购买计数
    const newCount = await this.redis.incr(REDIS_KEYS.GIFTPACK_PURCHASED(userId, packId));

    // 发放礼包内容
    const balanceAfter = await this.grantPackContents(userId, pack);

    return {
      packId: pack.id,
      packName: pack.name,
      price: 0,
      contents: pack.contents,
      balanceAfter,
      isFree: true,
      purchaseCount: newCount,
    };
  }

  /**
   * 检查礼包是否可购买
   */
  async checkPurchaseable(userId: number, packId: string): Promise<boolean> {
    const pack = this.packs.find(p => p.id === packId);
    if (!pack) return false;

    return this.isPackAvailable(userId, pack);
  }

  /**
   * 判断礼包是否可用
   */
  private async isPackAvailable(userId: number, pack: GiftPack): Promise<boolean> {
    const now = new Date();

    // 检查时间范围
    if (pack.availableFrom && now < pack.availableFrom) return false;
    if (pack.availableUntil && now > pack.availableUntil) return false;

    // 检查限购次数
    if (pack.limitPerUser) {
      const count = await this.getPurchaseCount(userId, pack.id);
      if (count >= pack.limitPerUser) return false;
    }

    // 每日礼包：检查今日是否已领取
    if (pack.type === 'daily') {
      const dailyClaimed = await this.redis.get(REDIS_KEYS.GIFTPACK_DAILY_CLAIMED(userId, pack.id));
      if (dailyClaimed) return false;
    }

    // 新手礼包：检查是否是新用户（简化：未购买过即可）
    if (pack.type === 'newbie') {
      const count = await this.getPurchaseCount(userId, pack.id);
      if (count >= 1) return false;
    }

    // 周礼包：检查本周是否已购买
    if (pack.type === 'weekly') {
      // 这里需要更复杂的逻辑来检查本周购买情况
      // 简化实现：使用Redis记录
      const weeklyKey = `giftpack:weekly:${userId}:${pack.id}`;
      const claimed = await this.redis.get(weeklyKey);
      if (claimed) return false;
    }

    return true;
  }

  /**
   * 获取购买次数
   */
  private async getPurchaseCount(userId: number, packId: string): Promise<number> {
    const count = await this.redis.get(REDIS_KEYS.GIFTPACK_PURCHASED(userId, packId));
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * 发放礼包内容
   */
  private async grantPackContents(userId: number, pack: GiftPack): Promise<number> {
    let balance = await this.getUserBalance(userId);

    for (const content of pack.contents) {
      switch (content.type) {
        case 'coins':
          await this.addCoins(userId, content.quantity);
          break;
        case 'vip_day':
          // 通过Redis发布VIP发放事件
          await this.redis.publish('economy:vip:grant', JSON.stringify({
            userId,
            days: content.quantity,
          }));
          break;
        case 'item':
          // 通过Redis发布道具发放事件
          await this.redis.publish('economy:item:grant', JSON.stringify({
            userId,
            itemId: content.itemId,
            quantity: content.quantity,
          }));
          break;
      }
    }

    // 重新获取余额
    const updated = await this.balanceRepo.findOne({ where: { userId } });
    return updated ? Number(updated.coins) : balance;
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
  private async addCoins(userId: number, amount: number): Promise<void> {
    await this.balanceRepo.increment({ userId }, 'coins', amount);
    await this.balanceRepo.increment({ userId }, 'totalEarned', amount);
  }
}
