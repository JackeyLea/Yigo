import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationEntity } from './notification.entity';
import { User } from '../../common/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity, User])],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
