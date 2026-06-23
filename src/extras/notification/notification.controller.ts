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
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

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

@ApiTags('Notification - 通知系统')
@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * 获取当前用户的通知列表
   */
  @Get()
  @ApiOperation({ summary: '通知列表', description: '获取当前用户的通知列表（分页）' })
  @ApiQuery({ name: 'page', required: false, description: '页码', example: 1 })
  async getNotifications(
    @CurrentUser('id') userId: number,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
  ) {
    const result = await this.notificationService.getNotifications(userId, page);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取未读通知数量
   */
  @Get('unread-count')
  @ApiOperation({ summary: '未读通知数', description: '获取当前用户未读通知数量' })
  async getUnreadCount(@CurrentUser('id') userId: number) {
    const count = await this.notificationService.getUnreadCount(userId);
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
  @ApiOperation({ summary: '标记已读', description: '将指定通知标记为已读' })
  @ApiParam({ name: 'id', description: '通知ID', example: 1 })
  async markAsRead(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) notificationId: number,
  ) {
    await this.notificationService.markAsRead(userId, notificationId);
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
  @ApiOperation({ summary: '全部已读', description: '将当前用户所有通知标记为已读' })
  async markAllAsRead(@CurrentUser('id') userId: number) {
    await this.notificationService.markAllAsRead(userId);
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
  @ApiOperation({ summary: '发送通知', description: '向指定用户发送通知（需管理员权限）' })
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
  @ApiOperation({ summary: '广播通知', description: '向所有用户发送广播通知（需管理员权限）' })
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
  @ApiOperation({ summary: '删除通知', description: '删除指定通知' })
  @ApiParam({ name: 'id', description: '通知ID', example: 1 })
  async deleteNotification(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) notificationId: number,
  ) {
    await this.notificationService.deleteNotification(userId, notificationId);
    return {
      success: true,
      message: '通知已删除',
    };
  }
}
