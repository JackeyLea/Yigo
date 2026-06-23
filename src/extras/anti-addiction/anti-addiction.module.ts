import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AntiAddictionService } from './anti-addiction.service';
import { AntiAddictionController } from './anti-addiction.controller';
import {
  RealNameVerification,
  DailyPlayTime,
  HolidayConfig,
} from './anti-addiction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RealNameVerification,
      DailyPlayTime,
      HolidayConfig,
    ]),
  ],
  controllers: [AntiAddictionController],
  providers: [AntiAddictionService],
  exports: [AntiAddictionService],
})
export class AntiAddictionModule {}
