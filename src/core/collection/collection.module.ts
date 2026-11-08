/**
 * CollectionModule - 牌谱/棋谱收藏模块
 *
 * 提供对局收藏、备注、标签、分享功能。
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';
import { CollectedGame } from './entities/collected-game.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CollectedGame])],
  controllers: [CollectionController],
  providers: [CollectionService],
  exports: [CollectionService],
})
export class CollectionModule {}
