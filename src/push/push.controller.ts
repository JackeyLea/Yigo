import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  ParseIntPipe,
} from '@nestjs/common';
import { PushService } from './push.service';
import { RegisterDeviceDto, SendPushDto, BroadcastPushDto, RoomInvitePushDto, GameReminderPushDto } from './dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register device token for push notifications' })
  async registerDevice(
    @Req() req: any,
    @Body() dto: RegisterDeviceDto,
  ) {
    const userId = req.user.userId;
    await this.pushService.registerDevice(userId, dto);
    return { success: true };
  }

  @Post('unregister')
  @ApiOperation({ summary: 'Unregister device token' })
  async unregisterDevice(
    @Req() req: any,
    @Body('deviceToken') deviceToken: string,
  ) {
    const userId = req.user.userId;
    await this.pushService.unregisterDevice(userId, deviceToken);
    return { success: true };
  }

  @Post('send')
  @ApiOperation({ summary: 'Send push to specific user (admin only)' })
  async sendToUser(
    @Body() dto: SendPushDto,
  ) {
    await this.pushService.sendToUser(dto.userId, dto.title, dto.body, dto.data);
    return { success: true };
  }

  @Post('broadcast')
  @ApiOperation({ summary: 'Broadcast push to all users (admin only)' })
  async broadcast(
    @Body() dto: BroadcastPushDto,
  ) {
    await this.pushService.broadcast(dto.title, dto.body, {
      platforms: dto.platforms,
      minLevel: dto.minLevel,
      maxLevel: dto.maxLevel,
      vipOnly: dto.vipOnly,
      gameTypes: dto.gameTypes,
    });
    return { success: true };
  }

  @Post('room-invite')
  @ApiOperation({ summary: 'Send room invitation push' })
  async sendRoomInvite(
    @Body() dto: RoomInvitePushDto,
  ) {
    await this.pushService.sendRoomInvite(dto.inviterId, dto.inviteeId, dto.roomId);
    return { success: true };
  }

  @Post('game-reminder')
  @ApiOperation({ summary: 'Send game start reminder' })
  async sendGameReminder(
    @Body() dto: GameReminderPushDto,
  ) {
    await this.pushService.sendGameStartReminder(dto.userId, dto.roomId);
    return { success: true };
  }

  @Post('activity/:activityId')
  @ApiOperation({ summary: 'Send activity notification' })
  async sendActivityNotification(
    @Query('activityId') activityId: string,
    @Query('title') title?: string,
    @Query('body') body?: string,
  ) {
    await this.pushService.sendActivityNotification(activityId, title, body);
    return { success: true };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get push statistics (admin only)' })
  async getPushStats(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.pushService.getPushStats(
      new Date(startDate),
      new Date(endDate),
    );
  }
}
