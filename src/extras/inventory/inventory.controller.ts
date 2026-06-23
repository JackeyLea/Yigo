import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { InventoryService, InventoryItemWithDefinition } from './inventory.service';
import { ItemDefinition } from './inventory.entity';
import { UseItemDto, AddItemDto, RemoveItemDto } from './dto/use-item.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /**
   * 获取用户背包列表
   */
  @Get(':userId')
  async getInventory(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<InventoryItemWithDefinition[]> {
    return this.inventoryService.getInventory(userId);
  }

  /**
   * 使用道具
   */
  @Post('use')
  @HttpCode(HttpStatus.OK)
  async useItem(@Body() dto: UseItemDto): Promise<void> {
    return this.inventoryService.useItem(
      dto.userId || 0,
      dto.itemId,
      dto.count || 1,
    );
  }

  /**
   * 添加道具
   */
  @Post('add')
  @HttpCode(HttpStatus.OK)
  async addItem(@Body() dto: AddItemDto): Promise<void> {
    return this.inventoryService.addItem(
      dto.userId,
      dto.itemId,
      dto.count,
      dto.source,
    );
  }

  /**
   * 移除道具
   */
  @Post('remove')
  @HttpCode(HttpStatus.OK)
  async removeItem(@Body() dto: RemoveItemDto): Promise<void> {
    return this.inventoryService.removeItem(dto.userId, dto.itemId, dto.count);
  }

  /**
   * 装备道具
   */
  @Post('equip/:userId/:inventoryItemId')
  @HttpCode(HttpStatus.OK)
  async equipItem(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('inventoryItemId', ParseIntPipe) inventoryItemId: number,
  ): Promise<void> {
    return this.inventoryService.equipItem(userId, inventoryItemId);
  }

  /**
   * 取消装备道具
   */
  @Post('unequip/:userId/:inventoryItemId')
  @HttpCode(HttpStatus.OK)
  async unequipItem(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('inventoryItemId', ParseIntPipe) inventoryItemId: number,
  ): Promise<void> {
    return this.inventoryService.unequipItem(userId, inventoryItemId);
  }

  /**
   * 获取道具定义列表
   */
  @Get('definitions/all')
  async getItemDefinitions(): Promise<ItemDefinition[]> {
    return this.inventoryService.getItemDefinitions();
  }

  /**
   * 清理过期道具
   */
  @Post('clean-expired/:userId')
  @HttpCode(HttpStatus.OK)
  async cleanExpiredItems(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ cleaned: number }> {
    const cleaned = await this.inventoryService.cleanExpiredItems(userId);
    return { cleaned };
  }
}
