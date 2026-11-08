import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LotteryService } from './lottery.service';
import { LotteryController } from './lottery.controller';
import { UserBalance } from '../common/entities';

@Module({
  imports: [TypeOrmModule.forFeature([UserBalance])],
  controllers: [LotteryController],
  providers: [LotteryService],
  exports: [LotteryService],
})
export class LotteryModule {}
