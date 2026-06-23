/**
 * RoomPlayerGuard - 房间成员权限守卫
 * 确保只有房间内的玩家可以执行特定操作
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
import { RoomPlayer } from '../../common/entities/room-player.entity';

@Injectable()
export class RoomPlayerGuard implements CanActivate {
  constructor(
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    @InjectRepository(RoomPlayer)
    private readonly roomPlayerRepository: Repository<RoomPlayer>,
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

    // 检查用户是否是房间内的玩家
    const player = await this.roomPlayerRepository.findOne({
      where: {
        room_id: roomId,
        user_id: userId,
        left_at: null as any,
      },
    });

    if (!player) {
      throw new ForbiddenException('你不是该房间的成员');
    }

    // 将房间和玩家信息附加到请求对象
    request.room = room;
    request.roomPlayer = player;

    return true;
  }
}
