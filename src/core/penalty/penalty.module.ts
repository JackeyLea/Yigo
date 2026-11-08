/**
 * PenaltyModule - 逃跑惩罚模块
 *
 * 管理逃跑行为记录和信誉分惩罚体系。
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PenaltyService } from './penalty.service';
import { PenaltyController } from './penalty.controller';
import { EscapeRecord } from './entities/escape-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EscapeRecord])],
  controllers: [PenaltyController],
  providers: [PenaltyService],
  exports: [PenaltyService],
})
export class PenaltyModule {}
