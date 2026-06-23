import { Module } from '@nestjs/common';
import { SeasonModule } from './season/season.module';
import { AntiAddictionModule } from './anti-addiction/anti-addiction.module';
import { RechargeModule } from './recharge/recharge.module';
import { InventoryModule } from './inventory/inventory.module';

/**
 * 运营与经济系统聚合模块
 * 
 * 包含以下子系统：
 * - 赛季系统 (SeasonModule): 赛季管理、排名、奖励发放
 * - 防沉迷系统 (AntiAddictionModule): 实名认证、游戏时长控制
 * - 充值系统 (RechargeModule): 充值订单、套餐管理
 * - 道具背包系统 (InventoryModule): 道具管理、使用、装备
 */
@Module({
  imports: [
    SeasonModule,
    AntiAddictionModule,
    RechargeModule,
    InventoryModule,
  ],
  exports: [
    SeasonModule,
    AntiAddictionModule,
    RechargeModule,
    InventoryModule,
  ],
})
export class ExtrasModule {}
