import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 道具类型枚举
 */
export enum ItemType {
  DOUBLE_EXP_CARD = 'double_exp_card',
  AUTO_MATCH_CARD = 'auto_match_card',
  ROOM_CREATE_CARD = 'room_create_card',
  NAME_CHANGE_CARD = 'name_change_card',
  AVATAR_FRAME = 'avatar_frame',
  TITLE = 'title',
}

/**
 * 背包道具实例
 */
@Entity('inventory_items')
export class InventoryItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  @Index()
  userId: number;

  @Column({ type: 'int' })
  itemDefId: number;

  @Column({ type: 'int', default: 1 })
  count: number;

  @Column({ type: 'boolean', default: false })
  isEquipped: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expiredAt: Date | null;

  @Column({ type: 'simple-json', nullable: true })
  extraData: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * 道具定义
 */
@Entity('item_definitions')
export class ItemDefinition {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  itemType: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  icon: string | null;

  @Column({ type: 'int', default: 0 })
  maxStack: number;

  @Column({ type: 'boolean', default: true })
  usable: boolean;

  @Column({ type: 'boolean', default: true })
  stackable: boolean;

  @Column({ type: 'simple-json', nullable: true })
  effectData: Record<string, any> | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * 道具流水记录
 */
@Entity('item_transactions')
export class ItemTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  @Index()
  userId: number;

  @Column({ type: 'int' })
  itemDefId: number;

  @Column({ type: 'int' })
  changeAmount: number;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  source: string;

  @Column({ type: 'varchar', length: 50 })
  transactionType: 'add' | 'remove' | 'use';

  @Column({ type: 'int' })
  balanceAfter: number;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
