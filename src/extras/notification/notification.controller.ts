import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../../common/decorators/current-user.decorator';

class SendNotificationDto {
  userId!: number;
  type!: string;
  title!: string;
  content!: string;
  data?: Record<string, any>;
}

class BroadcastDto {
  title!: string;
  content!: string;
  target?: string;
}

// 注：@nestjs/swagger 未在 package.json 中声明，相关装饰器已移除
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * 获取当前用户的通知列表
   */
  @Get()
  async getNotifications(
    @CurrentUser() user: CurrentUserData,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
  ) {
    const result = await this.notificationService.getNotifications(
      user.userId,
      page,
    );
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取未读通知数量
   */
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: CurrentUserData) {
    const count = await this.notificationService.getUnreadCount(user.userId);
    return {
      success: true,
      data: { count },
    };
  }

  /**
   * 标记单条通知为已读
   */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseIntPipe) notificationId: number,
  ) {
    await this.notificationService.markAsRead(user.userId, notificationId);
    return {
      success: true,
      message: '已标记为已读',
    };
  }

  /**
   * 标记全部通知为已读
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@CurrentUser() user: CurrentUserData) {
    await this.notificationService.markAllAsRead(user.userId);
    return {
      success: true,
      message: '全部通知已标记为已读',
    };
  }

  /**
   * 发送通知（管理员权限）
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  async sendNotification(@Body() dto: SendNotificationDto) {
    await this.notificationService.sendNotification(
      dto.userId,
      dto.type as any,
      dto.title,
      dto.content,
      dto.data,
    );
    return {
      success: true,
      message: '通知发送成功',
    };
  }

  /**
   * 发送广播通知（管理员权限）
   */
  @Post('broadcast')
  @HttpCode(HttpStatus.OK)
  async sendBroadcast(@Body() dto: BroadcastDto) {
    await this.notificationService.sendBroadcast(
      dto.title,
      dto.content,
      dto.target,
    );
    return {
      success: true,
      message: '广播发送成功',
    };
  }

  /**
   * 删除通知
   */
  @Post(':id/delete')
  @HttpCode(HttpStatus.OK)
  async deleteNotification(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseIntPipe) notificationId: number,
  ) {
    await this.notificationService.deleteNotification(user.userId, notificationId);
    return {
      success: true,
      message: '通知已删除',
    };
  }
}
