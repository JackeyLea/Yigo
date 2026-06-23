/**
 * RoomService - 房间管理业务逻辑层
 *
 * 负责处理房间的创建、查询、加入、离开、状态管理、房主权限、观战等功能。
 * 房间过期使用Redis TTL管理，状态转换使用状态机模式。
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Room, RoomStatus, RoomMode } from '../common/entities/room.entity';
import { RoomPlayer } from '../common/entities/room-player.entity';
import { User } from '../common/entities/user.entity';
import { EventBus } from '../plugin/event-bus';
import {
  RoomStateMachine,
  RoomEvent,
} from './room-state-machine';

import {
  CreateRoomDto,
  JoinRoomDto,
  RoomResponseDto,
  RoomPlayerDto,
  PaginatedResult,
} from './dto';

/** 生成6位随机房间码（大写字母+数字） */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Redis键前缀 */
const REDIS_KEY = {
  ROOM_EXPIRE: (roomId: string) => `room:expire:${roomId}`,
  ROOM_SPECTATORS: (roomId: string) => `room:spectators:${roomId}`,
  ROOM_SPECTATOR_COUNT: (roomId: string) => `room:spectator_count:${roomId}`,
  USER_ROOM: (userId: number) => `user:room:${userId}`,
};

/** 房间默认过期时间（秒） */
const ROOM_EXPIRE_SECONDS = 300;

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);
  private readonly redis: Redis;
  private readonly stateMachine: RoomStateMachine;

  constructor(
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    @InjectRepository(RoomPlayer)
    private readonly roomPlayerRepository: Repository<RoomPlayer>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBus,
  ) {
    // 初始化Redis连接
    const redisConfig = this.configService.get('redis');
    this.redis = new Redis({
      host: redisConfig?.host || 'localhost',
      port: redisConfig?.port || 6379,
      password: redisConfig?.password || undefined,
      db: redisConfig?.db || 0,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error:', err.message);
    });

    this.stateMachine = new RoomStateMachine();
  }

  // ==================== 房间创建 ====================

  /**
   * 创建房间
   * - 生成6位随机码，检查唯一性
   * - 房主自动加入为玩家
   * - 设置Redis过期时间
   */
  async createRoom(
    userId: number,
    dto: CreateRoomDto,
  ): Promise<RoomResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 生成唯一房间码
      let roomId: string;
      let attempts = 0;
      const maxAttempts = 10;

      do {
        roomId = generateRoomCode();
        const existing = await queryRunner.manager.findOne(Room, {
          where: { room_id: roomId },
        });
        if (!existing) break;
        attempts++;
      } while (attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        throw new ConflictException('无法生成唯一房间码，请重试');
      }

      const uid = String(userId);

      // 查询用户信息
      const user = await queryRunner.manager.findOne(User, {
        where: { user_id: uid as any },
      });
      if (!user) {
        throw new NotFoundException('用户不存在');
      }

      // 计算过期时间
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ROOM_EXPIRE_SECONDS * 1000);

      // 创建房间
      const room = queryRunner.manager.create(Room, {
        room_id: roomId,
        game_type: dto.pluginId,
        plugin_id: dto.pluginId,
        status: RoomStatus.WAITING,
        host_id: uid,
        max_players: dto.maxPlayers,
        current_players: 1,
        config_json: dto.config || {},
        mode: (dto.mode as RoomMode) || RoomMode.NORMAL,
        password_hash: dto.password || null,
        is_spectator_allowed: dto.allowSpectator ?? true,
        spectator_count: 0,
        created_at: now,
        updated_at: now,
        expired_at: expiresAt,
      });

      await queryRunner.manager.save(room);

      // 创建房主玩家记录
      const roomPlayer = queryRunner.manager.create(RoomPlayer, {
        room_id: roomId,
        user_id: uid,
        seat_index: 0,
        is_ready: true, // 房主默认准备
        is_host: true,
        is_ai: false,
        joined_at: now,
        left_at: null,
      });

      await queryRunner.manager.save(roomPlayer);

      await queryRunner.commitTransaction();

      // 设置Redis过期键
      await this.redis.setex(
        REDIS_KEY.ROOM_EXPIRE(roomId),
        ROOM_EXPIRE_SECONDS,
        String(userId),
      );

      // 记录用户当前所在房间
      await this.redis.setex(
        REDIS_KEY.USER_ROOM(userId),
        ROOM_EXPIRE_SECONDS,
        roomId,
      );

      // 广播房间创建事件
      this.eventBus.publishToRoom(roomId, 'room.created', {
        roomId,
        hostId: userId,
        pluginId: dto.pluginId,
      });

      // 构建响应
      const response = await this.buildRoomResponse(roomId);
      return response;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ==================== 房间查询 ====================

  /**
   * 查询房间详情
   */
  async getRoom(roomId: string): Promise<RoomResponseDto> {
    return this.buildRoomResponse(roomId);
  }

  /**
   * 房间列表（支持分页和筛选）
   */
  async listRooms(
    pluginId?: string,
    status?: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<RoomResponseDto>> {
    const where: any = {};

    if (pluginId) {
      where.plugin_id = pluginId;
    }

    if (status) {
      where.status = status;
    } else {
      // 默认只显示等待中和准备中的房间
      where.status = [RoomStatus.WAITING, RoomStatus.READY];
    }

    const [rooms, total] = await this.roomRepository.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const items = await Promise.all(
      rooms.map((room) => this.buildRoomResponse(room.room_id)),
    );

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ==================== 加入/离开房间 ====================

  /**
   * 加入房间
   * - 检查密码、人数、状态
   * - 自动分配座位
   * - 广播玩家列表更新
   */
  async joinRoom(
    userId: number,
    dto: JoinRoomDto,
  ): Promise<RoomResponseDto> {
    const { roomId, password, seatIndex } = dto;
    const uid = String(userId);

    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    // 检查房间状态
    if (room.status === RoomStatus.PLAYING || room.status === RoomStatus.FINISHED) {
      throw new ForbiddenException('房间当前不可加入');
    }

    // 检查密码
    if (room.password_hash && room.password_hash !== password) {
      throw new UnauthorizedException('房间密码错误');
    }

    // 检查人数上限
    if (room.current_players >= room.max_players) {
      throw new ForbiddenException('房间已满');
    }

    // 检查是否已在房间中
    const existingPlayer = await this.roomPlayerRepository.findOne({
      where: { room_id: roomId, user_id: uid, left_at: null as any },
    });

    if (existingPlayer) {
      throw new ConflictException('你已在该房间中');
    }

    // 使用事务确保原子性
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 确定座位号
      const occupiedSeats = (
        await queryRunner.manager.find(RoomPlayer, {
          where: { room_id: roomId, left_at: null as any },
        })
      ).map((p) => p.seat_index);

      let assignedSeat: number;
      if (seatIndex !== undefined && seatIndex >= 0 && seatIndex < room.max_players) {
        if (occupiedSeats.includes(seatIndex)) {
          throw new ConflictException(`座位 ${seatIndex} 已被占用`);
        }
        assignedSeat = seatIndex;
      } else {
        // 自动分配最小可用座位
        for (let i = 0; i < room.max_players; i++) {
          if (!occupiedSeats.includes(i)) {
            assignedSeat = i;
            break;
          }
        }
      }

      const now = new Date();

      // 创建玩家记录
      const newPlayer = queryRunner.manager.create(RoomPlayer, {
        room_id: roomId,
        user_id: uid,
        seat_index: assignedSeat!,
        is_ready: false,
        is_host: false,
        is_ai: false,
        joined_at: now,
        left_at: null,
      });

      await queryRunner.manager.save(newPlayer);

      // 更新房间人数
      await queryRunner.manager.update(
        Room,
        { room_id: roomId },
        {
          current_players: room.current_players + 1,
          updated_at: now,
        },
      );

      await queryRunner.commitTransaction();

      // 刷新Redis过期时间
      await this.redis.expire(
        REDIS_KEY.ROOM_EXPIRE(roomId),
        ROOM_EXPIRE_SECONDS,
      );
      await this.redis.setex(
        REDIS_KEY.USER_ROOM(userId),
        ROOM_EXPIRE_SECONDS,
        roomId,
      );

      // 广播玩家加入事件
      this.broadcastPlayerListUpdate(roomId);

      this.eventBus.publishToRoom(roomId, 'room.player_joined', {
        roomId,
        userId,
        seatIndex: assignedSeat,
      });

      return this.buildRoomResponse(roomId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 离开房间
   * - 房主离开需转移房主或解散
   * - 更新Redis用户房间记录
   */
  async leaveRoom(userId: number, roomId: string): Promise<void> {
    const uid = String(userId);

    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    const player = await this.roomPlayerRepository.findOne({
      where: { room_id: roomId, user_id: uid, left_at: null as any },
    });

    if (!player) {
      throw new ForbiddenException('你不是该房间的成员');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const now = new Date();
      const isHost = player.is_host;

      // 标记玩家离开
      await queryRunner.manager.update(
        RoomPlayer,
        { id: player.id },
        { left_at: now },
      );

      // 更新房间人数
      const newCount = Math.max(0, room.current_players - 1);
      await queryRunner.manager.update(
        Room,
        { room_id: roomId },
        {
          current_players: newCount,
          updated_at: now,
        },
      );

      if (isHost) {
        if (newCount === 0) {
          // 无人了，解散房间
          await queryRunner.manager.update(
            Room,
            { room_id: roomId },
            { status: RoomStatus.FINISHED, updated_at: now },
          );

          // 清理Redis
          await this.redis.del(REDIS_KEY.ROOM_EXPIRE(roomId));
          await this.redis.del(REDIS_KEY.ROOM_SPECTATORS(roomId));
          await this.redis.del(REDIS_KEY.ROOM_SPECTATOR_COUNT(roomId));
        } else {
          // 转移房主给最久在线的玩家
          const remainingPlayers = await queryRunner.manager.find(RoomPlayer, {
            where: { room_id: roomId, left_at: null as any },
            order: { joined_at: 'ASC' },
          });

          if (remainingPlayers.length > 0) {
            const newHost = remainingPlayers[0];
            await queryRunner.manager.update(
              RoomPlayer,
              { id: newHost.id },
              { is_host: true, is_ready: true },
            );
            await queryRunner.manager.update(
              Room,
              { room_id: roomId },
              { host_id: newHost.user_id, updated_at: now },
            );

            this.eventBus.publishToRoom(roomId, 'room.host_transferred', {
              roomId,
              newHostId: Number(newHost.user_id),
            });
          }
        }
      }

      await queryRunner.commitTransaction();

      // 清除用户房间记录
      await this.redis.del(REDIS_KEY.USER_ROOM(userId));

      // 广播事件
      this.broadcastPlayerListUpdate(roomId);
      this.eventBus.publishToRoom(roomId, 'room.player_left', {
        roomId,
        userId,
        isHost,
      });

      // 检查是否所有人都离开了
      if (!isHost && newCount > 0) {
        const allLeft = newCount === 0;
        if (allLeft) {
          await this.dissolveRoomInternal(roomId);
        }
      }
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ==================== 房主权限管理 ====================

  /**
   * 房主踢人
   */
  async kickPlayer(
    hostId: number,
    roomId: string,
    targetUserId: number,
  ): Promise<void> {
    const hostUid = String(hostId);
    const targetUid = String(targetUserId);

    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    if (room.host_id !== hostUid) {
      throw new ForbiddenException('只有房主可以踢人');
    }

    if (hostUid === targetUid) {
      throw new BadRequestException('不能踢出自己');
    }

    const targetPlayer = await this.roomPlayerRepository.findOne({
      where: { room_id: roomId, user_id: targetUid, left_at: null as any },
    });

    if (!targetPlayer) {
      throw new NotFoundException('目标玩家不在房间中');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const now = new Date();

      await queryRunner.manager.update(
        RoomPlayer,
        { id: targetPlayer.id },
        { left_at: now },
      );

      const newCount = Math.max(0, room.current_players - 1);
      await queryRunner.manager.update(
        Room,
        { room_id: roomId },
        {
          current_players: newCount,
          updated_at: now,
        },
      );

      await queryRunner.commitTransaction();

      // 清除被踢用户的房间记录
      await this.redis.del(REDIS_KEY.USER_ROOM(targetUserId));

      // 广播事件
      this.broadcastPlayerListUpdate(roomId);
      this.eventBus.publishToRoom(roomId, 'room.player_kicked', {
        roomId,
        userId: targetUserId,
        kickedBy: hostId,
      });
      this.eventBus.publishToPlayer(targetUserId.toString(), 'room.kicked', {
        roomId,
        reason: '你被房主移出房间',
      });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 转移房主
   */
  async transferHost(
    hostId: number,
    roomId: string,
    newHostId: number,
  ): Promise<void> {
    const hostUid = String(hostId);
    const newHostUid = String(newHostId);

    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    if (room.host_id !== hostUid) {
      throw new ForbiddenException('只有房主可以转移房主权限');
    }

    if (hostUid === newHostUid) {
      throw new BadRequestException('不能转移给自己');
    }

    const newHostPlayer = await this.roomPlayerRepository.findOne({
      where: { room_id: roomId, user_id: newHostUid, left_at: null as any },
    });

    if (!newHostPlayer) {
      throw new NotFoundException('目标玩家不在房间中');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 取消原房主标记
      await queryRunner.manager.update(
        RoomPlayer,
        { room_id: roomId, user_id: hostUid },
        { is_host: false },
      );

      // 设置新房主
      await queryRunner.manager.update(
        RoomPlayer,
        { id: newHostPlayer.id },
        { is_host: true, is_ready: true },
      );

      // 更新房间host_id
      await queryRunner.manager.update(
        Room,
        { room_id: roomId },
        { host_id: newHostUid },
      );

      await queryRunner.commitTransaction();

      this.broadcastPlayerListUpdate(roomId);
      this.eventBus.publishToRoom(roomId, 'room.host_transferred', {
        roomId,
        oldHostId: hostId,
        newHostId,
      });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 解散房间
   */
  async dissolveRoom(hostId: number, roomId: string): Promise<void> {
    const hostUid = String(hostId);

    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    if (room.host_id !== hostUid) {
      throw new ForbiddenException('只有房主可以解散房间');
    }

    await this.dissolveRoomInternal(roomId);
  }

  private async dissolveRoomInternal(roomId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const now = new Date();

      // 更新房间状态为已结束
      await queryRunner.manager.update(
        Room,
        { room_id: roomId },
        { status: RoomStatus.FINISHED, updated_at: now },
      );

      // 标记所有玩家离开
      await queryRunner.manager.update(
        RoomPlayer,
        { room_id: roomId, left_at: null as any },
        { left_at: now },
      );

      await queryRunner.commitTransaction();

      // 清理Redis
      await this.redis.del(REDIS_KEY.ROOM_EXPIRE(roomId));
      await this.redis.del(REDIS_KEY.ROOM_SPECTATORS(roomId));
      await this.redis.del(REDIS_KEY.ROOM_SPECTATOR_COUNT(roomId));

      // 获取所有玩家并清除房间记录
      const players = await this.roomPlayerRepository.find({
        where: { room_id: roomId },
      });
      for (const player of players) {
        await this.redis.del(
          REDIS_KEY.USER_ROOM(Number(player.user_id)),
        );
      }

      this.eventBus.publishToRoom(roomId, 'room.dissolved', {
        roomId,
        reason: '房间已解散',
      });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ==================== 准备/开始游戏 ====================

  /**
   * 设置准备状态
   */
  async setReady(
    userId: number,
    roomId: string,
    isReady: boolean,
  ): Promise<RoomResponseDto> {
    const uid = String(userId);

    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    if (room.status === RoomStatus.PLAYING || room.status === RoomStatus.FINISHED) {
      throw new ForbiddenException('房间当前不可更改准备状态');
    }

    const player = await this.roomPlayerRepository.findOne({
      where: { room_id: roomId, user_id: uid, left_at: null as any },
    });

    if (!player) {
      throw new ForbiddenException('你不是该房间的成员');
    }

    // 房主不需要准备
    if (player.is_host && isReady) {
      // 房主始终为准备状态
      return this.buildRoomResponse(roomId);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 更新准备状态
      await queryRunner.manager.update(
        RoomPlayer,
        { id: player.id },
        { is_ready: isReady },
      );

      // 获取最新的玩家列表进行状态检查
      const allPlayers = await queryRunner.manager.find(RoomPlayer, {
        where: { room_id: roomId, left_at: null as any },
      });

      // 尝试状态转换
      const event = isReady ? RoomEvent.PLAYER_READY : RoomEvent.PLAYER_UNREADY;
      const roomLike: any = {
        ...room,
        room_players: allPlayers,
      };

      try {
        const newStatus = this.stateMachine.transition(roomLike, event);
        if (newStatus !== room.status) {
          await queryRunner.manager.update(
            Room,
            { room_id: roomId },
            { status: newStatus },
          );
        }
      } catch (err) {
        // 状态转换失败不影响准备状态更新
        this.logger.debug(`State transition skipped: ${err.message}`);
      }

      await queryRunner.commitTransaction();

      // 广播事件
      this.broadcastPlayerListUpdate(roomId);
      this.eventBus.publishToRoom(roomId, 'room.ready_changed', {
        roomId,
        userId,
        isReady,
      });

      return this.buildRoomResponse(roomId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 房主开始游戏
   */
  async startGame(hostId: number, roomId: string): Promise<void> {
    const hostUid = String(hostId);

    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    if (room.host_id !== hostUid) {
      throw new ForbiddenException('只有房主可以开始游戏');
    }

    // 检查是否满足开始条件
    const players = await this.roomPlayerRepository.find({
      where: { room_id: roomId, left_at: null as any },
    });

    const roomLike: any = { ...room, room_players: players };

    if (!this.stateMachine.canStartGame(roomLike)) {
      throw new BadRequestException('不满足开始游戏条件：所有玩家必须已准备且人数在有效范围内');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const newStatus = this.stateMachine.transition(roomLike, RoomEvent.HOST_START);

      await queryRunner.manager.update(
        Room,
        { room_id: roomId },
        { status: newStatus, updated_at: new Date() },
      );

      await queryRunner.commitTransaction();

      // 清除准备状态（游戏开始后）
      for (const player of players) {
        if (!player.is_host) {
          await this.roomPlayerRepository.update(
            { id: player.id },
            { is_ready: false },
          );
        }
      }

      this.eventBus.publishToRoom(roomId, 'room.game_started', {
        roomId,
        hostId,
        players: players.map((p) => ({
          userId: Number(p.user_id),
          seatIndex: p.seat_index,
        })),
      });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ==================== 观战功能 ====================

  /**
   * 观战者加入
   */
  async spectatorJoin(spectatorId: number, roomId: string): Promise<void> {
    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    if (!room.is_spectator_allowed) {
      throw new ForbiddenException('该房间不允许观战');
    }

    if (room.status !== RoomStatus.PLAYING && room.status !== RoomStatus.PAUSED) {
      throw new ForbiddenException('只有游戏中的房间可以观战');
    }

    // 检查是否已在房间中作为玩家
    const existingPlayer = await this.roomPlayerRepository.findOne({
      where: {
        room_id: roomId,
        user_id: String(spectatorId),
        left_at: null as any,
      },
    });

    if (existingPlayer) {
      throw new ConflictException('你已是该房间的玩家，无法观战');
    }

    // 添加到观战列表（Redis Set）
    await this.redis.sadd(REDIS_KEY.ROOM_SPECTATORS(roomId), String(spectatorId));

    // 增加观战计数
    const count = await this.redis.incr(REDIS_KEY.ROOM_SPECTATOR_COUNT(roomId));

    // 更新数据库观战数
    await this.roomRepository.update(
      { room_id: roomId },
      { spectator_count: count },
    );

    // 延迟推送观战数据（避免实时看到手牌等敏感信息）
    setTimeout(() => {
      this.eventBus.publishToPlayer(String(spectatorId), 'room.spectate_data', {
        roomId,
        delay: 5, // 5秒延迟
        message: '开始接收观战数据',
      });
    }, 5000);

    this.eventBus.publishToRoom(roomId, 'room.spectator_joined', {
      roomId,
      spectatorId,
      spectatorCount: count,
    });
  }

  /**
   * 观战者离开
   */
  async spectatorLeave(spectatorId: number, roomId: string): Promise<void> {
    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    // 从观战列表移除
    await this.redis.srem(REDIS_KEY.ROOM_SPECTATORS(roomId), String(spectatorId));

    // 减少观战计数
    const count = await this.redis.decr(REDIS_KEY.ROOM_SPECTATOR_COUNT(roomId));
    const safeCount = Math.max(0, count);

    // 更新数据库观战数
    await this.roomRepository.update(
      { room_id: roomId },
      { spectator_count: safeCount },
    );

    this.eventBus.publishToRoom(roomId, 'room.spectator_left', {
      roomId,
      spectatorId,
      spectatorCount: safeCount,
    });
  }

  /**
   * 获取观战者列表
   */
  async getSpectators(roomId: string): Promise<number[]> {
    const members = await this.redis.smembers(REDIS_KEY.ROOM_SPECTATORS(roomId));
    return members.map(Number);
  }

  // ==================== 定时任务 ====================

  /**
   * 清理过期房间（每5分钟执行一次）
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupExpiredRooms(): Promise<void> {
    this.logger.debug('开始清理过期房间...');

    const now = new Date();
    const expiredRooms = await this.roomRepository.find({
      where: {
        status: RoomStatus.WAITING,
        expired_at: LessThan(now),
      },
    });

    for (const room of expiredRooms) {
      this.logger.log(`清理过期房间: ${room.room_id}`);
      await this.dissolveRoomInternal(room.room_id);
    }

    this.logger.debug(`清理完成，共处理 ${expiredRooms.length} 个过期房间`);
  }

  // ==================== 内部工具方法 ====================

  /**
   * 构建房间响应DTO
   */
  private async buildRoomResponse(roomId: string): Promise<RoomResponseDto> {
    const room = await this.roomRepository.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`房间 ${roomId} 不存在`);
    }

    // 查询玩家列表
    const players = await this.roomPlayerRepository.find({
      where: { room_id: roomId },
      order: { seat_index: 'ASC' },
    });

    // 获取观战人数
    const spectatorCount = await this.getSpectatorCount(roomId);

    // 构建玩家DTO
    const playerDtos: RoomPlayerDto[] = await Promise.all(
      players.map(async (player) => {
        const user = await this.userRepository.findOne({
          where: { user_id: player.user_id as any },
        });

        return {
          userId: Number(player.user_id),
          username: user?.username || '',
          nickname: user?.nickname || '',
          avatarUrl: user?.avatar_url || '',
          seatIndex: player.seat_index,
          isReady: player.is_ready,
          isHost: player.is_host,
        };
      }),
    );

    return {
      roomId: room.room_id,
      gameType: room.game_type,
      pluginId: room.plugin_id,
      status: room.status as any,
      hostId: Number(room.host_id),
      maxPlayers: room.max_players,
      currentPlayers: room.current_players,
      players: playerDtos,
      config: room.config_json,
      mode: room.mode,
      isPasswordProtected: !!room.password_hash,
      allowSpectator: room.is_spectator_allowed,
      spectatorCount,
      createdAt: room.created_at,
      expiresAt: room.expired_at,
    };
  }

  /**
   * 获取观战人数
   */
  private async getSpectatorCount(roomId: string): Promise<number> {
    const count = await this.redis.get(REDIS_KEY.ROOM_SPECTATOR_COUNT(roomId));
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * 广播玩家列表更新
   */
  private async broadcastPlayerListUpdate(roomId: string): Promise<void> {
    try {
      const room = await this.buildRoomResponse(roomId);
      this.eventBus.publishToRoom(roomId, 'room.player_list_updated', {
        roomId,
        players: room.players,
        currentPlayers: room.currentPlayers,
        status: room.status,
      });
    } catch (err) {
      this.logger.error(`广播玩家列表更新失败: ${err.message}`);
    }
  }
}
