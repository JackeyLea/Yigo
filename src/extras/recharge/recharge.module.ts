import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RechargeService } from './recharge.service';
import { RechargeController } from './recharge.controller';
import { RechargeOrder, RechargePack } from './recharge.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RechargeOrder, RechargePack])],
  controllers: [RechargeController],
  providers: [RechargeService],
  exports: [RechargeService],
})
export class RechargeModule {}
