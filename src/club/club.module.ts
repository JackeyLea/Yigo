import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClubService } from './club.service';
import { ClubController } from './club.controller';
import { Club, ClubMember, ClubApplication, ClubRoom } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([Club, ClubMember, ClubApplication, ClubRoom])],
  providers: [ClubService],
  controllers: [ClubController],
  exports: [ClubService],
})
export class ClubModule {}
