import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeasonService } from './season.service';
import { SeasonController } from './season.controller';
import { Season, SeasonReward, SeasonRanking } from './season.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Season, SeasonReward, SeasonRanking])],
  controllers: [SeasonController],
  providers: [SeasonService],
  exports: [SeasonService],
})
export class SeasonModule {}
