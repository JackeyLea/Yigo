import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  InventoryItem,
  ItemDefinition,
  ItemTransaction,
  ItemType,
} from './inventory.entity';

export interface InventoryItemWithDefinition extends InventoryItem {
  definition?: ItemDefinition;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(ItemDefinition)
    private readonly itemDefRepo: Repository<ItemDefinition>,
    @InjectRepository(ItemTransaction)
    private readonly transactionRepo: Repository<ItemTransaction>,
  ) {}

  /**
   * 获取用户背包列表
   */
  async getInventory(userId: number): Promise<InventoryItemWithDefinition[]> {
    const items = await this.inventoryRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    // 加载道具定义
    const results: InventoryItemWithDefinition[] = [];
    for (const item of items) {
      const definition = await this.itemDefRepo.findOne({
        where: { id: item.itemDefId },
      });
      results.push({ ...item, definition: definition || undefined });
    }

    return results;
  }

  /**
   * 使用道具
   */
  async useItem(
    userId: number,
    itemId: number,
    count: number = 1,
  ): Promise<void> {
    if (count <= 0) {
      throw new BadRequestException('使用数量必须大于0');
    }

    const item = await this.inventoryRepo.findOne({
      where: { id: itemId, userId },
    });

    if (!item) {
      throw new NotFoundException('道具不存在');
    }

    const definition = await this.itemDefRepo.findOne({
      where: { id: item.itemDefId },
    });

    if (!definition) {
      throw new NotFoundException('道具定义不存在');
    }

    if (!definition.usable) {
      throw new BadRequestException('该道具不可使用');
    }

    if (item.count < count) {
      throw new BadRequestException('道具数量不足');
    }

    // 检查是否过期
    if (item.expiredAt && item.expiredAt < new Date()) {
      throw new BadRequestException('道具已过期');
    }

    // 扣除数量
    item.count -= count;
    const newCount = item.count;

    if (item.count <= 0) {
      await this.inventoryRepo.remove(item);
    } else {
      await this.inventoryRepo.save(item);
    }

    // 记录流水
    await this.recordTransaction(
      userId,
      item.itemDefId,
      -count,
      'use',
      'user_action',
      newCount,
    );

    // 执行道具效果
    await this.applyItemEffect(userId, definition, count);
  }

  /**
   * 添加道具到背包
   */
  async addItem(
    userId: number,
    itemId: number,
    count: number,
    source: string,
    extraData?: Record<string, any>,
  ): Promise<void> {
    if (count <= 0) {
      throw new BadRequestException('添加数量必须大于0');
    }

    const definition = await this.itemDefRepo.findOne({
      where: { id: itemId },
    });

    if (!definition) {
      throw new NotFoundException('道具定义不存在');
    }

    if (!definition.isActive) {
      throw new BadRequestException('该道具已下架');
    }

    // 查找是否已有同类道具（可堆叠）
    const existingItem = definition.stackable
      ? await this.inventoryRepo.findOne({
          where: { userId, itemDefId: itemId },
        })
      : null;

    let newCount: number;

    if (existingItem) {
      // 堆叠数量检查
      if (definition.maxStack > 0 && existingItem.count + count > definition.maxStack) {
        throw new BadRequestException(
          `超出最大堆叠数量(${definition.maxStack})`,
        );
      }
      existingItem.count += count;
      if (extraData) {
        existingItem.extraData = { ...existingItem.extraData, ...extraData };
      }
      await this.inventoryRepo.save(existingItem);
      newCount = existingItem.count;
    } else {
      const item = new InventoryItem();
      item.userId = userId;
      item.itemDefId = itemId;
      item.count = count;
      item.isEquipped = false;
      item.expiredAt = null;
      item.extraData = extraData || null;
      await this.inventoryRepo.save(item);
      newCount = count;
    }

    // 记录流水
    await this.recordTransaction(
      userId,
      itemId,
      count,
      'add',
      source,
      newCount,
    );
  }

  /**
   * 从背包移除道具
   */
  async removeItem(
    userId: number,
    itemId: number,
    count: number,
  ): Promise<void> {
    if (count <= 0) {
      throw new BadRequestException('移除数量必须大于0');
    }

    const item = await this.inventoryRepo.findOne({
      where: { itemDefId: itemId, userId },
    });

    if (!item) {
      throw new NotFoundException('道具不存在');
    }

    if (item.count < count) {
      throw new BadRequestException('道具数量不足');
    }

    item.count -= count;
    const newCount = item.count;

    if (item.count <= 0) {
      await this.inventoryRepo.remove(item);
    } else {
      await this.inventoryRepo.save(item);
    }

    // 记录流水
    await this.recordTransaction(
      userId,
      itemId,
      -count,
      'remove',
      'system',
      newCount,
    );
  }

  /**
   * 获取道具定义列表
   */
  async getItemDefinitions(): Promise<ItemDefinition[]> {
    return this.itemDefRepo.find({
      where: { isActive: true },
      order: { itemType: 'ASC', id: 'ASC' },
    });
  }

  /**
   * 按类型获取道具定义
   */
  async getItemDefinitionsByType(itemType: ItemType): Promise<ItemDefinition[]> {
    return this.itemDefRepo.find({
      where: { itemType, isActive: true },
      order: { id: 'ASC' },
    });
  }

  /**
   * 装备道具（头像框、称号等）
   */
  async equipItem(userId: number, inventoryItemId: number): Promise<void> {
    const item = await this.inventoryRepo.findOne({
      where: { id: inventoryItemId, userId },
    });

    if (!item) {
      throw new NotFoundException('道具不存在');
    }

    const definition = await this.itemDefRepo.findOne({
      where: { id: item.itemDefId },
    });

    if (!definition) {
      throw new NotFoundException('道具定义不存在');
    }

    if (
      definition.itemType !== ItemType.AVATAR_FRAME &&
      definition.itemType !== ItemType.TITLE
    ) {
      throw new BadRequestException('该道具不可装备');
    }

    // 同类型道具先全部取消装备
    const sameTypeItems = await this.inventoryRepo.find({
      where: { userId },
    });

    for (const si of sameTypeItems) {
      const siDef = await this.itemDefRepo.findOne({
        where: { id: si.itemDefId },
      });
      if (siDef && siDef.itemType === definition.itemType && si.isEquipped) {
        si.isEquipped = false;
        await this.inventoryRepo.save(si);
      }
    }

    item.isEquipped = true;
    await this.inventoryRepo.save(item);
  }

  /**
   * 取消装备道具
   */
  async unequipItem(userId: number, inventoryItemId: number): Promise<void> {
    const item = await this.inventoryRepo.findOne({
      where: { id: inventoryItemId, userId },
    });

    if (!item) {
      throw new NotFoundException('道具不存在');
    }

    item.isEquipped = false;
    await this.inventoryRepo.save(item);
  }

  /**
   * 清理过期道具
   */
  async cleanExpiredItems(userId?: number): Promise<number> {
    const query = this.inventoryRepo
      .createQueryBuilder()
      .delete()
      .from(InventoryItem)
      .where('expiredAt IS NOT NULL')
      .andWhere('expiredAt < :now', { now: new Date() });

    if (userId !== undefined) {
      query.andWhere('userId = :userId', { userId });
    }

    const result = await query.execute();
    return result.affected || 0;
  }

  // ==================== 私有方法 ====================

  /**
   * 记录道具流水
   */
  private async recordTransaction(
    userId: number,
    itemDefId: number,
    changeAmount: number,
    transactionType: 'add' | 'remove' | 'use',
    source: string,
    balanceAfter: number,
    remark?: string,
  ): Promise<void> {
    const tx = new ItemTransaction();
    tx.userId = userId;
    tx.itemDefId = itemDefId;
    tx.changeAmount = changeAmount;
    tx.transactionType = transactionType;
    tx.source = source;
    tx.balanceAfter = balanceAfter;
    tx.remark = remark || null;

    await this.transactionRepo.save(tx);
  }

  /**
   * 应用道具使用效果
   */
  private async applyItemEffect(
    userId: number,
    definition: ItemDefinition,
    count: number,
  ): Promise<void> {
    const effectData = definition.effectData || {};

    switch (definition.itemType) {
      case ItemType.DOUBLE_EXP_CARD: {
        // 双倍经验卡：在effectData中记录经验倍率和持续时间
        const duration = effectData.duration || 3600; // 默认1小时
        const multiplier = effectData.multiplier || 2;
        // TODO: 调用用户服务激活双倍经验buff
        console.log(
          `[Inventory] User ${userId} activated double exp: ${multiplier}x for ${duration}s`,
        );
        break;
      }

      case ItemType.AUTO_MATCH_CARD: {
        // 自动匹配卡：增加自动匹配次数
        const matchCount = effectData.matchCount || 10;
        // TODO: 调用匹配服务增加自动匹配次数
        console.log(
          `[Inventory] User ${userId} used auto match card: +${matchCount * count} matches`,
        );
        break;
      }

      case ItemType.ROOM_CREATE_CARD: {
        // 建房卡：增加建房次数
        const roomCount = effectData.roomCount || 1;
        // TODO: 调用房间服务增加建房次数
        console.log(
          `[Inventory] User ${userId} used room create card: +${roomCount * count} rooms`,
        );
        break;
      }

      case ItemType.NAME_CHANGE_CARD: {
        // 改名卡：允许修改用户名
        // TODO: 调用用户服务开启改名权限
        console.log(`[Inventory] User ${userId} used name change card`);
        break;
      }

      case ItemType.AVATAR_FRAME:
      case ItemType.TITLE: {
        // 头像框和称号：装备
        // 查找背包中的道具进行装备
        const inventoryItem = await this.inventoryRepo.findOne({
          where: { userId, itemDefId: definition.id },
        });
        if (inventoryItem) {
          await this.equipItem(userId, inventoryItem.id);
        }
        break;
      }

      default:
        console.log(
          `[Inventory] User ${userId} used unknown item type: ${definition.itemType}`,
        );
    }
  }
}
