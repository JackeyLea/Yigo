/**
 * RoomHostGuard - 房主权限守卫
 * 确保只有房主可以执行特定操作
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Room } from '../../common/entities/room.entity';

@Injectable()
export class RoomHostGuard implements CanActivate {
  constructor(
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const roomId = request.params?.roomId || request.body?.roomId;

    if (!user) {
      throw new ForbiddenException('未授权访问');
    }

    if (!roomId) {
      throw new NotFoundException('房间ID不能为空');
    }

    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    const userId = String(user.user_id || user.id);
    if (String(room.host_id) !== userId) {
      throw new ForbiddenException('只有房主可以执行此操作');
    }

    // 将房间信息附加到请求对象，避免后续重复查询
    request.room = room;

    return true;
  }
}
