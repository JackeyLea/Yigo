import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import {
  RechargeOrder,
  RechargeOrderStatus,
  RechargePack,
} from './recharge.entity';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RechargePackDto {
  id: string;
  name: string;
  gold: number;
  amount: number;
  bonus: number;
  totalGold: number;
}

// 默认充值套餐配置
const DEFAULT_RECHARGE_PACKS: RechargePackDto[] = [
  { id: 'pack_60', name: '60金币', gold: 60, amount: 6, bonus: 0, totalGold: 60 },
  { id: 'pack_300', name: '300金币', gold: 300, amount: 30, bonus: 30, totalGold: 330 },
  { id: 'pack_980', name: '980金币', gold: 980, amount: 98, bonus: 120, totalGold: 1100 },
  { id: 'pack_1980', name: '1980金币', gold: 1980, amount: 198, bonus: 300, totalGold: 2280 },
  { id: 'pack_3280', name: '3280金币', gold: 3280, amount: 328, bonus: 600, totalGold: 3880 },
  { id: 'pack_6480', name: '6480金币', gold: 6480, amount: 648, bonus: 1500, totalGold: 7980 },
];

@Injectable()
export class RechargeService {
  constructor(
    @InjectRepository(RechargeOrder)
    private readonly orderRepo: Repository<RechargeOrder>,
    @InjectRepository(RechargePack)
    private readonly packRepo: Repository<RechargePack>,
  ) {}

  /**
   * 创建充值订单
   */
  async createOrder(
    userId: number,
    amount: number,
    channel: string,
    packId?: string,
  ): Promise<RechargeOrder> {
    // 验证充值套餐
    const pack = DEFAULT_RECHARGE_PACKS.find((p) => p.id === packId);
    if (!pack) {
      throw new BadRequestException('充值套餐不存在');
    }

    if (pack.amount !== amount) {
      throw new BadRequestException('充值金额与套餐不匹配');
    }

    const order = new RechargeOrder();
    order.userId = userId;
    order.amount = amount;
    order.goldAmount = pack.gold;
    order.bonusGold = pack.bonus;
    order.channel = channel;
    order.status = RechargeOrderStatus.PENDING;
    order.transactionId = null;
    order.paidAt = null;

    return this.orderRepo.save(order);
  }

  /**
   * 确认充值到账
   */
  async confirmOrder(
    orderId: string,
    transactionId: string,
  ): Promise<void> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status === RechargeOrderStatus.PAID) {
      throw new BadRequestException('订单已支付');
    }

    if (order.status === RechargeOrderStatus.CANCELLED) {
      throw new BadRequestException('订单已取消');
    }

    if (order.status === RechargeOrderStatus.FAILED) {
      throw new BadRequestException('订单已失败');
    }

    order.status = RechargeOrderStatus.PAID;
    order.transactionId = transactionId;
    order.paidAt = new Date();

    await this.orderRepo.save(order);

    // TODO: 此处触发金币到账逻辑，给用户增加金币
    // await this.userService.addGold(order.userId, order.goldAmount + order.bonusGold);
  }

  /**
   * 取消订单
   */
  async cancelOrder(orderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status !== RechargeOrderStatus.PENDING) {
      throw new BadRequestException('只能取消待支付订单');
    }

    order.status = RechargeOrderStatus.CANCELLED;
    await this.orderRepo.save(order);
  }

  /**
   * 获取充值记录（分页）
   */
  async getRechargeHistory(
    userId: number,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<RechargeOrder>> {
    const [items, total] = await this.orderRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取充值套餐列表
   */
  async getRechargePacks(): Promise<RechargePackDto[]> {
    return DEFAULT_RECHARGE_PACKS.map((pack) => ({
      ...pack,
      totalGold: pack.gold + pack.bonus,
    }));
  }

  /**
   * 根据ID查询订单
   */
  async getOrder(orderId: string): Promise<RechargeOrder> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    return order;
  }

  /**
   * 自动取消超时订单（30分钟未支付）
   */
  async cancelExpiredOrders(): Promise<number> {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const expiredOrders = await this.orderRepo.find({
      where: {
        status: RechargeOrderStatus.PENDING,
        createdAt: LessThan(thirtyMinutesAgo),
      },
    });

    for (const order of expiredOrders) {
      order.status = RechargeOrderStatus.CANCELLED;
    }

    if (expiredOrders.length > 0) {
      await this.orderRepo.save(expiredOrders);
    }

    return expiredOrders.length;
  }

  /**
   * 获取用户在时间范围内的充值总额
   */
  async getTotalRechargeAmount(
    userId: number,
    startDate?: Date,
    endDate?: Date,
  ): Promise<number> {
    const query = this.orderRepo
      .createQueryBuilder('order')
      .select('SUM(order.amount)', 'total')
      .where('order.userId = :userId', { userId })
      .andWhere('order.status = :status', { status: RechargeOrderStatus.PAID });

    if (startDate) {
      query.andWhere('order.paidAt >= :startDate', { startDate });
    }

    if (endDate) {
      query.andWhere('order.paidAt <= :endDate', { endDate });
    }

    const result = await query.getRawOne();
    return Number(result?.total) || 0;
  }

  /**
   * 获取用户今日充值金额
   */
  async getDailyRechargeAmount(userId: number): Promise<number> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    return this.getTotalRechargeAmount(userId, startOfDay, endOfDay);
  }
}
