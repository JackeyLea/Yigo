import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankruptcyModule } from './bankruptcy/bankruptcy.module';
import { LotteryModule } from './lottery/lottery.module';
import { VipModule } from './vip/vip.module';
import { GiftpackModule } from './giftpack/giftpack.module';
import { UserBalance } from './common/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserBalance]),
    BankruptcyModule,
    LotteryModule,
    VipModule,
    GiftpackModule,
  ],
  exports: [BankruptcyModule, LotteryModule, VipModule, GiftpackModule],
})
export class EconomyModule {}
