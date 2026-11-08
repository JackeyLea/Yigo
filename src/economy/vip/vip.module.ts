import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VipService } from './vip.service';
import { VipController } from './vip.controller';
import { UserBalance } from '../common/entities';

@Module({
  imports: [TypeOrmModule.forFeature([UserBalance])],
  controllers: [VipController],
  providers: [VipService],
  exports: [VipService],
})
export class VipModule {}
