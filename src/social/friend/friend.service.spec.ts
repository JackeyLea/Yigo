/**
 * FriendService Unit Tests
 * 好友服务单元测试
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

import { FriendService, FriendRequest } from './friend.service';
import { Friend, FriendStatus } from '../entities/friend.entity';
import { User } from '../../common/entities/user.entity';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    setnx: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    hincrby: jest.fn().mockResolvedValue(1),
    hget: jest.fn().mockResolvedValue(null),
    hgetall: jest.fn().mockResolvedValue({}),
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    lpush: jest.fn().mockResolvedValue(1),
    ltrim: jest.fn().mockResolvedValue('OK'),
    lrange: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(1),
    pipeline: jest.fn().mockReturnValue({
      sadd: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      lpush: jest.fn().mockReturnThis(),
      ltrim: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    on: jest.fn(),
  }));
});

describe('FriendService', () => {
  let service: FriendService;
  let friendRepository: Repository<Friend>;
  let userRepository: Repository<User>;

  const mockFriendRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
      getOne: jest.fn(),
      getMany: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getRawMany: jest.fn(),
    }),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    findByIds: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendService,
        {
          provide: getRepositoryToken(Friend),
          useValue: mockFriendRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<FriendService>(FriendService);
    friendRepository = module.get<Repository<Friend>>(getRepositoryToken(Friend));
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  describe('sendFriendRequest', () => {
    it('should send friend request successfully', async () => {
      const fromUserId = 1;
      const toUserId = 2;

      mockUserRepository.findOne.mockResolvedValue({ user_id: '2', username: 'user2' });
      mockFriendRepository.createQueryBuilder().getOne = jest.fn().mockResolvedValue(null);
      mockFriendRepository.create.mockReturnValue({});
      mockFriendRepository.save.mockResolvedValue([]);

      await service.sendFriendRequest(fromUserId, toUserId);

      expect(mockUserRepository.findOne).toHaveBeenCalled();
      expect(mockFriendRepository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException when sending to self', async () => {
      await expect(service.sendFriendRequest(1, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when target user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.sendFriendRequest(1, 999)).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when already friends', async () => {
      mockUserRepository.findOne.mockResolvedValue({ user_id: '2' });
      mockFriendRepository.createQueryBuilder().getOne = jest.fn().mockResolvedValue({
        status: FriendStatus.ACCEPTED,
      });

      await expect(service.sendFriendRequest(1, 2)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when request already pending', async () => {
      mockUserRepository.findOne.mockResolvedValue({ user_id: '2' });
      mockFriendRepository.createQueryBuilder().getOne = jest.fn().mockResolvedValue({
        status: FriendStatus.PENDING,
      });

      await expect(service.sendFriendRequest(1, 2)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when user is blocked', async () => {
      mockUserRepository.findOne.mockResolvedValue({ user_id: '2' });
      mockFriendRepository.createQueryBuilder().getOne = jest.fn().mockResolvedValue({
        status: FriendStatus.BLOCKED,
      });

      await expect(service.sendFriendRequest(1, 2)).rejects.toThrow(ConflictException);
    });
  });

  describe('acceptFriendRequest', () => {
    it('should accept friend request successfully', async () => {
      const userId = 2;
      const requestId = 'req-1';

      mockFriendRepository.findOne.mockResolvedValue({
        id: requestId,
        user_id: '2',
        friend_id: '1',
        status: FriendStatus.PENDING,
        requester_id: '1',
      });

      await service.acceptFriendRequest(userId, requestId);

      expect(mockFriendRepository.update).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when request not found', async () => {
      mockFriendRepository.findOne.mockResolvedValue(null);

      await expect(service.acceptFriendRequest(2, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when request not pending', async () => {
      mockFriendRepository.findOne.mockResolvedValue({
        id: 'req-1',
        status: FriendStatus.ACCEPTED,
      });

      await expect(service.acceptFriendRequest(2, 'req-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('rejectFriendRequest', () => {
    it('should reject friend request successfully', async () => {
      const userId = 2;
      const requestId = 'req-1';

      mockFriendRepository.findOne.mockResolvedValue({
        id: requestId,
        user_id: '2',
        friend_id: '1',
        status: FriendStatus.PENDING,
        requester_id: '1',
      });

      await service.rejectFriendRequest(userId, requestId);

      expect(mockFriendRepository.delete).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when request not found', async () => {
      mockFriendRepository.findOne.mockResolvedValue(null);

      await expect(service.rejectFriendRequest(2, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeFriend', () => {
    it('should remove friend successfully', async () => {
      mockFriendRepository.delete.mockResolvedValue({ affected: 1 });

      await service.removeFriend(1, 2);

      expect(mockFriendRepository.delete).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when friend relationship not found', async () => {
      mockFriendRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.removeFriend(1, 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFriendList', () => {
    it('should return friend list with online status', async () => {
      const mockFriends = [
        {
          id: '1',
          user_id: '1',
          friend_id: '2',
          status: FriendStatus.ACCEPTED,
          created_at: new Date(),
        },
        {
          id: '2',
          user_id: '1',
          friend_id: '3',
          status: FriendStatus.ACCEPTED,
          created_at: new Date(),
        },
      ];

      mockFriendRepository.find.mockResolvedValue(mockFriends);
      mockUserRepository.findByIds.mockResolvedValue([
        { user_id: '2', username: 'user2', nickname: 'User2', avatar_url: '' },
        { user_id: '3', username: 'user3', nickname: 'User3', avatar_url: '' },
      ]);

      const result = await service.getFriendList(1);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('isOnline');
      expect(result[0]).toHaveProperty('friendName');
    });

    it('should return empty array when no friends', async () => {
      mockFriendRepository.find.mockResolvedValue([]);

      const result = await service.getFriendList(1);

      expect(result).toEqual([]);
    });
  });

  describe('getFriendRequests', () => {
    it('should return pending friend requests', async () => {
      const mockRequests = [
        {
          id: '1',
          user_id: '2',
          friend_id: '1',
          status: FriendStatus.PENDING,
          requester_id: '2',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockFriendRepository.find.mockResolvedValue(mockRequests);

      const result = await service.getFriendRequests(1);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(FriendStatus.PENDING);
    });
  });

  describe('searchPlayers', () => {
    it('should return matching users', async () => {
      const mockUsers = [
        { user_id: '2', username: 'testuser', nickname: 'Test' },
      ];

      mockUserRepository.createQueryBuilder().getMany = jest.fn().mockResolvedValue(mockUsers);

      const result = await service.searchPlayers(1, 'test');

      expect(result).toHaveLength(1);
    });

    it('should return empty array for empty keyword', async () => {
      const result = await service.searchPlayers(1, '   ');

      expect(result).toEqual([]);
    });
  });

  describe('blockUser', () => {
    it('should block user successfully', async () => {
      mockUserRepository.findOne.mockResolvedValue({ user_id: '2' });
      mockFriendRepository.createQueryBuilder().execute = jest.fn().mockResolvedValue({});
      mockFriendRepository.create.mockReturnValue({});
      mockFriendRepository.save.mockResolvedValue({});

      await service.blockUser(1, 2);

      // 好友关系通过 QueryBuilder 的 delete() 删除（需同时匹配双向关系）
      const queryBuilder = mockFriendRepository.createQueryBuilder();
      expect(queryBuilder.delete).toHaveBeenCalled();
      expect(queryBuilder.execute).toHaveBeenCalled();
      expect(mockFriendRepository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException when blocking self', async () => {
      await expect(service.blockUser(1, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when target user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.blockUser(1, 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('unblockUser', () => {
    it('should unblock user successfully', async () => {
      mockFriendRepository.delete.mockResolvedValue({ affected: 1 });

      await service.unblockUser(1, 2);

      expect(mockFriendRepository.delete).toHaveBeenCalledWith({
        user_id: '1',
        friend_id: '2',
        status: FriendStatus.BLOCKED,
      });
    });

    it('should throw NotFoundException when block record not found', async () => {
      mockFriendRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.unblockUser(1, 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBlockedList', () => {
    it('should return blocked user ids', async () => {
      const result = await service.getBlockedList(1);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('areFriends', () => {
    it('should return true when users are friends', async () => {
      mockFriendRepository.findOne.mockResolvedValue({
        status: FriendStatus.ACCEPTED,
      });

      const result = await service.areFriends(1, 2);

      expect(result).toBe(true);
    });

    it('should return false when users are not friends', async () => {
      mockFriendRepository.findOne.mockResolvedValue(null);

      const result = await service.areFriends(1, 999);

      expect(result).toBe(false);
    });
  });
});
