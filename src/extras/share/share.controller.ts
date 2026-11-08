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
import { ShareService, ShareData } from './share.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../../common/decorators/current-user.decorator';

class GenerateShareCardDto {
  type!: string;
  data!: Record<string, any>;
}

// 注：@nestjs/swagger 未在 package.json 中声明，相关装饰器已移除
@Controller('share')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  /**
   * 生成分享卡片
   */
  @Post('card')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async generateShareCard(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: GenerateShareCardDto,
  ) {
    const imageUrl = await this.shareService.generateShareCard(
      user.userId,
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
  @HttpCode(HttpStatus.OK)
  async shareGameResult(
    @CurrentUser() user: CurrentUserData,
    @Param('recordId', ParseIntPipe) recordId: number,
  ) {
    const shareData: ShareData = await this.shareService.shareGameResult(
      user.userId,
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
  @HttpCode(HttpStatus.OK)
  async shareRoomInvite(
    @CurrentUser() user: CurrentUserData,
    @Param('roomId') roomId: string,
  ) {
    const shareData: ShareData = await this.shareService.shareRoomInvite(
      user.userId,
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
  @HttpCode(HttpStatus.OK)
  async shareAchievement(
    @CurrentUser() user: CurrentUserData,
    @Param('achievementId') achievementId: string,
    @Query('name') achievementName: string,
  ) {
    const shareData: ShareData = await this.shareService.shareAchievement(
      user.userId,
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
  @HttpCode(HttpStatus.OK)
  async shareProfile(@CurrentUser() user: CurrentUserData) {
    const shareData: ShareData = await this.shareService.shareProfile(user.userId);
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
  async getShareRecord(@Param('shareId') shareId: string) {
    const record = await this.shareService.getShareRecord(shareId);
    return {
      success: true,
      data: record,
    };
  }
}
