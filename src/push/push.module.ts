import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { DeviceToken, PushLog } from './entities';
import { PushQueueProcessor } from './push.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeviceToken, PushLog]),
    ScheduleModule.forRoot(),
  ],
  providers: [PushService, PushQueueProcessor],
  controllers: [PushController],
  exports: [PushService],
})
export class PushModule {}
