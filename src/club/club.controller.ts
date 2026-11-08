import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ClubService } from './club.service';
import { CreateClubDto, JoinApplicationDto, ApproveApplicationDto, CreateRoomDto, DonateDto } from './dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Club')
@ApiBearerAuth()
@Controller('clubs')
export class ClubController {
  constructor(private readonly clubService: ClubService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new club' })
  async createClub(
    @Req() req: any,
    @Body() dto: CreateClubDto,
  ) {
    const userId = req.user.userId;
    return this.clubService.createClub(userId, dto);
  }

  @Post('apply')
  @ApiOperation({ summary: 'Apply to join a club' })
  async applyToJoin(
    @Req() req: any,
    @Body() dto: JoinApplicationDto,
  ) {
    const userId = req.user.userId;
    return this.clubService.applyToJoin(userId, dto);
  }

  @Post('approve')
  @ApiOperation({ summary: 'Approve a membership application' })
  async approveApplication(
    @Req() req: any,
    @Body() dto: ApproveApplicationDto,
  ) {
    const adminId = req.user.userId;
    return this.clubService.approveApplication(adminId, dto);
  }

  @Post('reject')
  @ApiOperation({ summary: 'Reject a membership application' })
  async rejectApplication(
    @Req() req: any,
    @Body() dto: ApproveApplicationDto,
  ) {
    const adminId = req.user.userId;
    return this.clubService.rejectApplication(adminId, dto);
  }

  @Post(':clubId/leave')
  @ApiOperation({ summary: 'Leave a club' })
  async leaveClub(
    @Req() req: any,
    @Param('clubId') clubId: string,
  ) {
    const userId = req.user.userId;
    return this.clubService.leaveClub(clubId, userId);
  }

  @Post(':clubId/kick/:memberId')
  @ApiOperation({ summary: 'Kick a member from club' })
  async kickMember(
    @Req() req: any,
    @Param('clubId') clubId: string,
    @Param('memberId', ParseIntPipe) memberId: number,
  ) {
    const adminId = req.user.userId;
    return this.clubService.kickMember(clubId, memberId, adminId);
  }

  @Get(':clubId')
  @ApiOperation({ summary: 'Get club info' })
  async getClub(@Param('clubId') clubId: string) {
    return this.clubService.getClub(clubId);
  }

  @Get(':clubId/members')
  @ApiOperation({ summary: 'Get club member list' })
  async getMembers(
    @Param('clubId') clubId: string,
    @Query('page', ParseIntPipe) page?: number,
  ) {
    return this.clubService.getMembers(clubId, page || 1);
  }

  @Get()
  @ApiOperation({ summary: 'List clubs with optional search' })
  async listClubs(
    @Query('keyword') keyword?: string,
    @Query('page', ParseIntPipe) page?: number,
  ) {
    return this.clubService.listClubs(keyword, page || 1);
  }

  @Post('rooms')
  @ApiOperation({ summary: 'Create a club room' })
  async createClubRoom(
    @Req() req: any,
    @Body() dto: CreateRoomDto,
  ) {
    const userId = req.user.userId;
    return this.clubService.createClubRoom(userId, dto);
  }

  @Get(':clubId/leaderboard')
  @ApiOperation({ summary: 'Get club leaderboard' })
  async getClubLeaderboard(
    @Param('clubId') clubId: string,
    @Query('type') type: 'week' | 'month' | 'all' = 'all',
  ) {
    return this.clubService.getClubLeaderboard(clubId, type);
  }

  @Post('donate')
  @ApiOperation({ summary: 'Donate to club' })
  async donate(
    @Req() req: any,
    @Body() dto: DonateDto,
  ) {
    const userId = req.user.userId;
    return this.clubService.donate(userId, dto);
  }

  @Post(':clubId/transfer/:newOwnerId')
  @ApiOperation({ summary: 'Transfer club ownership' })
  async transferOwnership(
    @Req() req: any,
    @Param('clubId') clubId: string,
    @Param('newOwnerId', ParseIntPipe) newOwnerId: number,
  ) {
    const ownerId = req.user.userId;
    return this.clubService.transferOwnership(clubId, ownerId, newOwnerId);
  }

  @Post(':clubId/admin/:memberId')
  @ApiOperation({ summary: 'Set member as admin' })
  async setAdmin(
    @Req() req: any,
    @Param('clubId') clubId: string,
    @Param('memberId', ParseIntPipe) memberId: number,
  ) {
    const ownerId = req.user.userId;
    return this.clubService.setAdmin(clubId, ownerId, memberId);
  }
}
