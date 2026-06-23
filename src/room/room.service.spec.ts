/**
 * RoomService Unit Tests
 * 房间服务单元测试
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ForbiddenException, ConflictException, BadRequestException, UnauthorizedException } from '@nestjs/common';

import { RoomService } from './room.service';
import { RoomStateMachine, RoomEvent } from './room-state-machine';
import { EventBus } from '../plugin/event-bus';
import { Room, RoomStatus, RoomMode } from '../common/entities/room.entity';
import { RoomPlayer } from '../common/entities/room-player.entity';
import { User } from '../common/entities/user.entity';
import { CreateRoomDto, JoinRoomDto } from './dto';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    incr: jest.fn().mockResolvedValue(1),
    decr: jest.fn().mockResolvedValue(0),
    on: jest.fn(),
  }));
});

describe('RoomService', () => {
  let service: RoomService;
  let roomRepository: Repository<Room>;
  let roomPlayerRepository: Repository<RoomPlayer>;
  let userRepository: Repository<User>;
  let dataSource: DataSource;
  let eventBus: EventBus;

  // Mock query runner
  const mockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockEventBus = {
    publishToRoom: jest.fn(),
    publishToPlayer: jest.fn(),
    publish: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomService,
        RoomStateMachine,
        {
          provide: getRepositoryToken(Room),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
            }),
          },
        },
        {
          provide: getRepositoryToken(RoomPlayer),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            create: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              host: 'localhost',
              port: 6379,
              db: 0,
            }),
          },
        },
        {
          provide: EventBus,
          useValue: mockEventBus,
        },
      ],
    }).compile();

    service = module.get<RoomService>(RoomService);
    roomRepository = module.get<Repository<Room>>(getRepositoryToken(Room));
    roomPlayerRepository = module.get<Repository<RoomPlayer>>(getRepositoryToken(RoomPlayer));
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    dataSource = module.get<DataSource>(DataSource);
    eventBus = module.get<EventBus>(EventBus);
  });

  describe('createRoom', () => {
    const createRoomDto: CreateRoomDto = {
      pluginId: 'chess',
      maxPlayers: 4,
      allowSpectator: true,
      mode: 'normal',
    };

    it('should create a room successfully', async () => {
      const userId = 1;
      const mockUser = { user_id: '1', username: 'testuser', nickname: 'Test', avatar_url: '' };
      const mockRoom = {
        room_id: 'ABC123',
        game_type: 'chess',
        plugin_id: 'chess',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 1,
        config_json: {},
        mode: RoomMode.NORMAL,
        password_hash: null,
        is_spectator_allowed: true,
        spectator_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
        expired_at: new Date(Date.now() + 300000),
      };
      const mockRoomPlayer = {
        room_id: 'ABC123',
        user_id: '1',
        seat_index: 0,
        is_ready: true,
        is_host: true,
        is_ai: false,
        joined_at: new Date(),
        left_at: null,
      };

      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(null) // room_id uniqueness check
        .mockResolvedValueOnce(mockUser) // user lookup
        .mockResolvedValueOnce(mockRoom); // final room lookup

      mockQueryRunner.manager.create
        .mockReturnValueOnce(mockRoom) // Room entity
        .mockReturnValueOnce(mockRoomPlayer); // RoomPlayer entity

      mockQueryRunner.manager.save.mockResolvedValue(mockRoom);

      // Mock roomPlayers for buildRoomResponse
      roomPlayerRepository.find = jest.fn().mockResolvedValue([
        { ...mockRoomPlayer, id: '1' },
      ]);

      const result = await service.createRoom(userId, createRoomDto);

      expect(result).toBeDefined();
      expect(result.roomId).toBe('ABC123');
      expect(result.hostId).toBe(1);
      expect(result.status).toBe(RoomStatus.WAITING);
      expect(result.currentPlayers).toBe(1);
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw ConflictException after max attempts to generate room code', async () => {
      const userId = 1;
      const mockUser = { user_id: '1', username: 'testuser' };

      // Always return existing room, simulating collision
      mockQueryRunner.manager.findOne
        .mockResolvedValue({ room_id: 'EXIST' }) // room_id exists
        .mockResolvedValueOnce(mockUser);

      await expect(service.createRoom(userId, createRoomDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('getRoom', () => {
    it('should return room details', async () => {
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        game_type: 'chess',
        plugin_id: 'chess',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 2,
        config_json: {},
        mode: RoomMode.NORMAL,
        password_hash: null,
        is_spectator_allowed: true,
        spectator_count: 0,
        created_at: new Date(),
        expired_at: new Date(),
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.find = jest.fn().mockResolvedValue([
        { user_id: '1', seat_index: 0, is_ready: true, is_host: true, is_ai: false, joined_at: new Date() },
        { user_id: '2', seat_index: 1, is_ready: false, is_host: false, is_ai: false, joined_at: new Date() },
      ]);
      userRepository.findOne = jest.fn().mockImplementation(({ where }) => {
        if (where.user_id === '1') return { user_id: '1', username: 'user1', nickname: 'User1', avatar_url: '' };
        if (where.user_id === '2') return { user_id: '2', username: 'user2', nickname: 'User2', avatar_url: '' };
        return null;
      });

      const result = await service.getRoom(roomId);

      expect(result).toBeDefined();
      expect(result.roomId).toBe(roomId);
      expect(result.players).toHaveLength(2);
    });

    it('should throw NotFoundException for non-existent room', async () => {
      roomRepository.findOne = jest.fn().mockResolvedValue(null);

      await expect(service.getRoom('NONEXIST')).rejects.toThrow(NotFoundException);
    });
  });

  describe('joinRoom', () => {
    const joinRoomDto: JoinRoomDto = {
      roomId: 'ABC123',
      password: undefined,
    };

    it('should allow player to join room', async () => {
      const userId = 2;
      const mockRoom = {
        room_id: 'ABC123',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 1,
        password_hash: null,
        game_type: 'chess',
        plugin_id: 'chess',
        config_json: {},
        mode: RoomMode.NORMAL,
        is_spectator_allowed: true,
        spectator_count: 0,
        created_at: new Date(),
        expired_at: new Date(),
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockImplementation(({ where }) => {
        if (where.user_id === '2' && where.left_at === null) return null;
        return null;
      });

      mockQueryRunner.manager.find = jest.fn().mockResolvedValue([
        { user_id: '1', seat_index: 0, is_ready: true, is_host: true },
      ]);
      mockQueryRunner.manager.create.mockReturnValue({
        room_id: 'ABC123',
        user_id: '2',
        seat_index: 1,
        is_ready: false,
        is_host: false,
      });
      mockQueryRunner.manager.save.mockResolvedValue({});

      // Mock for buildRoomResponse
      roomPlayerRepository.find = jest.fn().mockResolvedValue([
        { user_id: '1', seat_index: 0, is_ready: true, is_host: true, is_ai: false, joined_at: new Date() },
        { user_id: '2', seat_index: 1, is_ready: false, is_host: false, is_ai: false, joined_at: new Date() },
      ]);
      userRepository.findOne = jest.fn().mockImplementation(({ where }) => {
        if (where.user_id === '1') return { user_id: '1', username: 'user1', nickname: 'User1', avatar_url: '' };
        if (where.user_id === '2') return { user_id: '2', username: 'user2', nickname: 'User2', avatar_url: '' };
        return null;
      });

      const result = await service.joinRoom(userId, joinRoomDto);

      expect(result).toBeDefined();
      expect(result.currentPlayers).toBe(2);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent room', async () => {
      roomRepository.findOne = jest.fn().mockResolvedValue(null);

      await expect(service.joinRoom(2, joinRoomDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when room is full', async () => {
      const mockRoom = {
        room_id: 'ABC123',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 2,
        current_players: 2,
        password_hash: null,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);

      await expect(service.joinRoom(3, joinRoomDto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when player already in room', async () => {
      const mockRoom = {
        room_id: 'ABC123',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 1,
        password_hash: null,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockImplementation(({ where }) => {
        if (where.user_id === '2') return { user_id: '2', room_id: 'ABC123' };
        return null;
      });

      await expect(service.joinRoom(2, joinRoomDto)).rejects.toThrow(ConflictException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const mockRoom = {
        room_id: 'ABC123',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 1,
        password_hash: 'secret123',
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);

      await expect(
        service.joinRoom(2, { ...joinRoomDto, password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('leaveRoom', () => {
    it('should allow player to leave room', async () => {
      const userId = 2;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 2,
      };
      const mockPlayer = {
        id: '2',
        user_id: '2',
        room_id: roomId,
        is_host: false,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockResolvedValue(mockPlayer);
      mockQueryRunner.manager.find = jest.fn().mockResolvedValue([
        { user_id: '1', joined_at: new Date(), is_host: true },
      ]);

      await service.leaveRoom(userId, roomId);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should transfer host when host leaves and players remain', async () => {
      const userId = 1;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 2,
      };
      const mockPlayer = {
        id: '1',
        user_id: '1',
        room_id: roomId,
        is_host: true,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockResolvedValue(mockPlayer);
      mockQueryRunner.manager.find = jest.fn().mockResolvedValue([
        { id: '2', user_id: '2', joined_at: new Date('2024-01-02'), is_host: false },
      ]);

      await service.leaveRoom(userId, roomId);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockEventBus.publishToRoom).toHaveBeenCalledWith(
        roomId,
        'room.host_transferred',
        expect.any(Object),
      );
    });

    it('should dissolve room when host leaves and no players remain', async () => {
      const userId = 1;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 1,
      };
      const mockPlayer = {
        id: '1',
        user_id: '1',
        room_id: roomId,
        is_host: true,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockResolvedValue(mockPlayer);
      mockQueryRunner.manager.find = jest.fn().mockResolvedValue([]);

      await service.leaveRoom(userId, roomId);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('kickPlayer', () => {
    it('should allow host to kick player', async () => {
      const hostId = 1;
      const roomId = 'ABC123';
      const targetUserId = 2;
      const mockRoom = {
        room_id: roomId,
        host_id: '1',
        current_players: 2,
      };
      const targetPlayer = {
        id: '2',
        user_id: '2',
        room_id: roomId,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockImplementation(({ where }) => {
        if (where.user_id === '2') return targetPlayer;
        return null;
      });

      await service.kickPlayer(hostId, roomId, targetUserId);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockEventBus.publishToPlayer).toHaveBeenCalledWith(
        targetUserId.toString(),
        'room.kicked',
        expect.objectContaining({ roomId }),
      );
    });

    it('should throw ForbiddenException when non-host tries to kick', async () => {
      const hostId = 2;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        host_id: '1',
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);

      await expect(service.kickPlayer(hostId, roomId, 3)).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when host tries to kick themselves', async () => {
      const hostId = 1;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        host_id: '1',
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);

      await expect(service.kickPlayer(hostId, roomId, 1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('transferHost', () => {
    it('should allow host to transfer ownership', async () => {
      const hostId = 1;
      const roomId = 'ABC123';
      const newHostId = 2;
      const mockRoom = {
        room_id: roomId,
        host_id: '1',
      };
      const newHostPlayer = {
        id: '2',
        user_id: '2',
        room_id: roomId,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockImplementation(({ where }) => {
        if (where.user_id === '2') return newHostPlayer;
        return null;
      });

      await service.transferHost(hostId, roomId, newHostId);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockEventBus.publishToRoom).toHaveBeenCalledWith(
        roomId,
        'room.host_transferred',
        expect.any(Object),
      );
    });

    it('should throw BadRequestException when transferring to self', async () => {
      roomRepository.findOne = jest.fn().mockResolvedValue({
        room_id: 'ABC123',
        host_id: '1',
      });

      await expect(service.transferHost(1, 'ABC123', 1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('setReady', () => {
    it('should set player ready status', async () => {
      const userId = 2;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 2,
      };
      const mockPlayer = {
        id: '2',
        user_id: '2',
        room_id: roomId,
        is_host: false,
        is_ready: false,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockResolvedValue(mockPlayer);
      mockQueryRunner.manager.find = jest.fn().mockResolvedValue([
        { user_id: '1', is_ready: true, is_host: true, is_ai: false, joined_at: new Date() },
        { user_id: '2', is_ready: true, is_host: false, is_ai: false, joined_at: new Date() },
      ]);

      // Mock buildRoomResponse
      roomPlayerRepository.find = jest.fn().mockResolvedValue([
        { user_id: '1', seat_index: 0, is_ready: true, is_host: true, is_ai: false, joined_at: new Date() },
        { user_id: '2', seat_index: 1, is_ready: true, is_host: false, is_ai: false, joined_at: new Date() },
      ]);
      userRepository.findOne = jest.fn().mockImplementation(({ where }) => {
        if (where.user_id === '1') return { user_id: '1', username: 'user1', nickname: 'User1', avatar_url: '' };
        if (where.user_id === '2') return { user_id: '2', username: 'user2', nickname: 'User2', avatar_url: '' };
        return null;
      });

      const result = await service.setReady(userId, roomId, true);

      expect(result).toBeDefined();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should skip ready update for host', async () => {
      const userId = 1;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 1,
      };
      const mockPlayer = {
        id: '1',
        user_id: '1',
        room_id: roomId,
        is_host: true,
        is_ready: true,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockResolvedValue(mockPlayer);
      roomPlayerRepository.find = jest.fn().mockResolvedValue([
        { user_id: '1', seat_index: 0, is_ready: true, is_host: true, is_ai: false, joined_at: new Date() },
      ]);
      userRepository.findOne = jest.fn().mockResolvedValue({
        user_id: '1', username: 'user1', nickname: 'User1', avatar_url: '',
      });

      await service.setReady(userId, roomId, true);

      // Host ready should skip and just return response
      expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
    });
  });

  describe('startGame', () => {
    it('should allow host to start game', async () => {
      const hostId = 1;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        status: RoomStatus.READY,
        host_id: '1',
        max_players: 4,
        current_players: 2,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.find = jest.fn().mockResolvedValue([
        { user_id: '1', is_ready: true, is_host: true, seat_index: 0 },
        { user_id: '2', is_ready: true, is_host: false, seat_index: 1 },
      ]);

      await service.startGame(hostId, roomId);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockEventBus.publishToRoom).toHaveBeenCalledWith(
        roomId,
        'room.game_started',
        expect.any(Object),
      );
    });

    it('should throw BadRequestException when conditions not met', async () => {
      const hostId = 1;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 1,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.find = jest.fn().mockResolvedValue([
        { user_id: '1', is_ready: true, is_host: true, seat_index: 0 },
      ]);

      await expect(service.startGame(hostId, roomId)).rejects.toThrow(BadRequestException);
    });
  });

  describe('dissolveRoom', () => {
    it('should allow host to dissolve room', async () => {
      const hostId = 1;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        host_id: '1',
        current_players: 0,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.find = jest.fn().mockResolvedValue([]);

      await service.dissolveRoom(hostId, roomId);

      expect(mockEventBus.publishToRoom).toHaveBeenCalledWith(
        roomId,
        'room.dissolved',
        expect.any(Object),
      );
    });

    it('should throw ForbiddenException when non-host tries to dissolve', async () => {
      roomRepository.findOne = jest.fn().mockResolvedValue({
        room_id: 'ABC123',
        host_id: '1',
      });

      await expect(service.dissolveRoom(2, 'ABC123')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('spectatorJoin', () => {
    it('should allow spectator to join', async () => {
      const spectatorId = 99;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        status: RoomStatus.PLAYING,
        is_spectator_allowed: true,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockResolvedValue(null);

      await service.spectatorJoin(spectatorId, roomId);

      expect(mockEventBus.publishToRoom).toHaveBeenCalledWith(
        roomId,
        'room.spectator_joined',
        expect.any(Object),
      );
    });

    it('should throw ForbiddenException when spectating not allowed', async () => {
      const mockRoom = {
        room_id: 'ABC123',
        status: RoomStatus.PLAYING,
        is_spectator_allowed: false,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);

      await expect(service.spectatorJoin(99, 'ABC123')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when player tries to spectate', async () => {
      const mockRoom = {
        room_id: 'ABC123',
        status: RoomStatus.PLAYING,
        is_spectator_allowed: true,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);
      roomPlayerRepository.findOne = jest.fn().mockResolvedValue({
        user_id: '99',
        room_id: 'ABC123',
      });

      await expect(service.spectatorJoin(99, 'ABC123')).rejects.toThrow(ConflictException);
    });
  });

  describe('spectatorLeave', () => {
    it('should allow spectator to leave', async () => {
      const spectatorId = 99;
      const roomId = 'ABC123';
      const mockRoom = {
        room_id: roomId,
        status: RoomStatus.PLAYING,
      };

      roomRepository.findOne = jest.fn().mockResolvedValue(mockRoom);

      await service.spectatorLeave(spectatorId, roomId);

      expect(mockEventBus.publishToRoom).toHaveBeenCalledWith(
        roomId,
        'room.spectator_left',
        expect.any(Object),
      );
    });
  });

  describe('listRooms', () => {
    it('should return paginated room list', async () => {
      const mockRooms = [
        {
          room_id: 'ABC123',
          game_type: 'chess',
          plugin_id: 'chess',
          status: RoomStatus.WAITING,
          host_id: '1',
          max_players: 4,
          current_players: 1,
          config_json: {},
          mode: RoomMode.NORMAL,
          password_hash: null,
          is_spectator_allowed: true,
          spectator_count: 0,
          created_at: new Date(),
          updated_at: new Date(),
          expired_at: new Date(),
        },
      ];

      roomRepository.findAndCount = jest.fn().mockResolvedValue([mockRooms, 1]);
      roomPlayerRepository.find = jest.fn().mockResolvedValue([
        { user_id: '1', seat_index: 0, is_ready: true, is_host: true, is_ai: false, joined_at: new Date() },
      ]);
      userRepository.findOne = jest.fn().mockResolvedValue({
        user_id: '1', username: 'user1', nickname: 'User1', avatar_url: '',
      });

      const result = await service.listRooms();

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });
  });
});
