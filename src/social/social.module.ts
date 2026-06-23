import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FriendService } from './friend/friend.service';
import { ChatService } from './chat/chat.service';
import { ReportService } from './report/report.service';
import { FriendController } from './friend/friend.controller';
import { ChatController } from './chat/chat.controller';
import { ReportController } from './report/report.controller';
import { SocialGateway } from './social.gateway';
import { Friend, ChatMessage, Report } from './entities';
import { User } from '../common/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Friend, ChatMessage, Report, User])],
  controllers: [FriendController, ChatController, ReportController],
  providers: [FriendService, ChatService, ReportService, SocialGateway],
  exports: [FriendService, ChatService, ReportService],
})
export class SocialModule {}
