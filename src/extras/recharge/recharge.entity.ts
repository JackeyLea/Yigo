import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum RechargeOrderStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum RechargeChannel {
  WECHAT = 'wechat',
  ALIPAY = 'alipay',
  APPLE = 'apple',
  GOOGLE = 'google',
}

/**
 * 充值订单
 */
@Entity('recharge_orders')
export class RechargeOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  @Index()
  userId: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'int', default: 0 })
  goldAmount: number;

  @Column({ type: 'int', default: 0 })
  bonusGold: number;

  @Column({ type: 'varchar', length: 50 })
  channel: string;

  @Column({
    type: 'enum',
    enum: RechargeOrderStatus,
    default: RechargeOrderStatus.PENDING,
  })
  @Index()
  status: RechargeOrderStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  transactionId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  thirdPartyOrderId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * 充值套餐
 */
@Entity('recharge_packs')
export class RechargePack {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'int' })
  gold: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'int', default: 0 })
  bonus: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
