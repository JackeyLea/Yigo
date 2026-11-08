import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GiftpackService } from './giftpack.service';
import { GiftpackController } from './giftpack.controller';
import { UserBalance } from '../common/entities';

@Module({
  imports: [TypeOrmModule.forFeature([UserBalance])],
  controllers: [GiftpackController],
  providers: [GiftpackService],
  exports: [GiftpackService],
})
export class GiftpackModule {}
