import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ShareService, ShareData } from './share.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

class GenerateShareCardDto {
  type!: string;
  data!: Record<string, any>;
}

@ApiTags('Share - 分享功能')
@Controller('api/v1/share')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  /**
   * 生成分享卡片
   */
  @Post('card')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '生成分享卡片', description: '生成指定类型的分享卡片图片URL' })
  async generateShareCard(
    @CurrentUser('id') userId: number,
    @Body() dto: GenerateShareCardDto,
  ) {
    const imageUrl = await this.shareService.generateShareCard(
      userId,
      dto.type,
      dto.data,
    );
    return {
      success: true,
      data: { imageUrl },
    };
  }

  /**
   * 分享游戏战绩
   */
  @Post('game-result/:recordId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '分享游戏战绩', description: '分享指定游戏记录的战绩卡片' })
  @ApiParam({ name: 'recordId', description: '游戏记录ID', example: 1 })
  async shareGameResult(
    @CurrentUser('id') userId: number,
    @Param('recordId', ParseIntPipe) recordId: number,
  ) {
    const shareData: ShareData = await this.shareService.shareGameResult(
      userId,
      recordId,
    );
    return {
      success: true,
      data: shareData,
    };
  }

  /**
   * 分享房间邀请
   */
  @Post('room-invite/:roomId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '分享房间邀请', description: '生成房间邀请分享卡片' })
  @ApiParam({ name: 'roomId', description: '房间ID', example: 'room-abc123' })
  async shareRoomInvite(
    @CurrentUser('id') userId: number,
    @Param('roomId') roomId: string,
  ) {
    const shareData: ShareData = await this.shareService.shareRoomInvite(
      userId,
      roomId,
    );
    return {
      success: true,
      data: shareData,
    };
  }

  /**
   * 分享成就
   */
  @Post('achievement/:achievementId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '分享成就', description: '分享成就解锁卡片' })
  @ApiParam({ name: 'achievementId', description: '成就ID', example: 'first_win' })
  async shareAchievement(
    @CurrentUser('id') userId: number,
    @Param('achievementId') achievementId: string,
    @Query('name') achievementName: string,
  ) {
    const shareData: ShareData = await this.shareService.shareAchievement(
      userId,
      achievementId,
      achievementName,
    );
    return {
      success: true,
      data: shareData,
    };
  }

  /**
   * 分享个人主页
   */
  @Post('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '分享个人主页', description: '生成个人主页分享卡片' })
  async shareProfile(@CurrentUser('id') userId: number) {
    const shareData: ShareData = await this.shareService.shareProfile(userId);
    return {
      success: true,
      data: shareData,
    };
  }

  /**
   * 追踪分享点击（公开接口，无需认证）
   */
  @Post('track/:shareId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '追踪分享点击', description: '记录分享链接的点击次数' })
  @ApiParam({ name: 'shareId', description: '分享ID', example: 'abc123' })
  async trackShare(@Param('shareId') shareId: string) {
    await this.shareService.trackShare(shareId);
    return {
      success: true,
      message: '点击已记录',
    };
  }

  /**
   * 获取分享记录详情（公开接口）
   */
  @Get('record/:shareId')
  @ApiOperation({ summary: '获取分享详情', description: '获取分享记录的详细信息' })
  @ApiParam({ name: 'shareId', description: '分享ID', example: 'abc123' })
  async getShareRecord(@Param('shareId') shareId: string) {
    const record = await this.shareService.getShareRecord(shareId);
    return {
      success: true,
      data: record,
    };
  }
}
