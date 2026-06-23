/**
 * ChatService Unit Tests
 * 聊天服务单元测试
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { ChatService } from './chat.service';
import {
  ChatMessage,
  ChatMessageType,
  ChatTargetType,
} from '../entities/chat-message.entity';
import { Friend, FriendStatus } from '../entities/friend.entity';

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

describe('ChatService', () => {
  let service: ChatService;
  let chatMessageRepository: Repository<ChatMessage>;
  let friendRepository: Repository<Friend>;

  const mockChatRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getMany: jest.fn(),
      getRawMany: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    }),
    query: jest.fn().mockResolvedValue([]),
  };

  const mockFriendRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(ChatMessage),
          useValue: mockChatRepository,
        },
        {
          provide: getRepositoryToken(Friend),
          useValue: mockFriendRepository,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    chatMessageRepository = module.get<Repository<ChatMessage>>(
      getRepositoryToken(ChatMessage),
    );
    friendRepository = module.get<Repository<Friend>>(getRepositoryToken(Friend));
  });

  describe('sendMessage', () => {
    it('should send private message successfully', async () => {
      const fromUserId = 1;
      const toUserId = 2;
      const content = 'Hello!';

      const mockMessage = {
        message_id: '1',
        sender_id: '1',
        receiver_id: '2',
        content,
        message_type: ChatMessageType.TEXT,
        target_type: ChatTargetType.PRIVATE,
        is_read: false,
        created_at: new Date(),
      };

      mockFriendRepository.findOne.mockResolvedValue(null); // not blocked
      mockChatRepository.create.mockReturnValue(mockMessage);
      mockChatRepository.save.mockResolvedValue(mockMessage);

      const result = await service.sendMessage(fromUserId, toUserId, content);

      expect(result).toBeDefined();
      expect(result.sender_id).toBe('1');
      expect(result.receiver_id).toBe('2');
      expect(result.content).toBe(content);
    });

    it('should send image message successfully', async () => {
      const mockMessage = {
        message_id: '1',
        sender_id: '1',
        receiver_id: '2',
        content: 'image.png',
        message_type: ChatMessageType.IMAGE,
        target_type: ChatTargetType.PRIVATE,
        is_read: false,
        created_at: new Date(),
      };

      mockFriendRepository.findOne.mockResolvedValue(null);
      mockChatRepository.create.mockReturnValue(mockMessage);
      mockChatRepository.save.mockResolvedValue(mockMessage);

      const result = await service.sendMessage(1, 2, 'image.png', ChatMessageType.IMAGE);

      expect(result.message_type).toBe(ChatMessageType.IMAGE);
    });

    it('should throw BadRequestException when sending to self', async () => {
      await expect(service.sendMessage(1, 1, 'Hello')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when content is empty', async () => {
      await expect(service.sendMessage(1, 2, '')).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.sendMessage(1, 2, '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException when blocked by target user', async () => {
      mockFriendRepository.findOne.mockResolvedValue({
        user_id: '2',
        friend_id: '1',
        status: FriendStatus.BLOCKED,
      });

      await expect(service.sendMessage(1, 2, 'Hello')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('sendRoomMessage', () => {
    it('should send room message successfully', async () => {
      const mockMessage = {
        message_id: '1',
        sender_id: '1',
        receiver_id: null,
        room_id: 'ROOM123',
        content: 'Hello room!',
        message_type: ChatMessageType.TEXT,
        target_type: ChatTargetType.ROOM,
        is_read: true,
        created_at: new Date(),
      };

      mockChatRepository.create.mockReturnValue(mockMessage);
      mockChatRepository.save.mockResolvedValue(mockMessage);

      const result = await service.sendRoomMessage(1, 'ROOM123', 'Hello room!');

      expect(result).toBeDefined();
      expect(result.room_id).toBe('ROOM123');
      expect(result.target_type).toBe(ChatTargetType.ROOM);
    });

    it('should throw BadRequestException when room content is empty', async () => {
      await expect(service.sendRoomMessage(1, 'ROOM123', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getHistory', () => {
    it('should return paginated chat history', async () => {
      const mockMessages = [
        {
          message_id: '1',
          sender_id: '1',
          receiver_id: '2',
          content: 'Hello',
          created_at: new Date(),
        },
        {
          message_id: '2',
          sender_id: '2',
          receiver_id: '1',
          content: 'Hi',
          created_at: new Date(),
        },
      ];

      mockChatRepository.findAndCount.mockResolvedValue([mockMessages, 2]);

      const result = await service.getHistory(1, 2);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should return empty result when no messages', async () => {
      mockChatRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getHistory(1, 999);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getRoomHistory', () => {
    it('should return room chat history', async () => {
      const mockMessages = [
        {
          message_id: '1',
          sender_id: '1',
          room_id: 'ROOM123',
          content: 'Hello room',
          created_at: new Date(),
        },
      ];

      mockChatRepository.findAndCount.mockResolvedValue([mockMessages, 1]);

      const result = await service.getRoomHistory('ROOM123');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].room_id).toBe('ROOM123');
    });
  });

  describe('getUnreadCount', () => {
    it('should return total unread count from Redis', async () => {
      const { hgetall } = require('ioredis')();
      hgetall.mockResolvedValueOnce({ '2': '3', '3': '5' });

      const result = await service.getUnreadCount(1);

      expect(result).toBe(8);
    });

    it('should fallback to database when Redis empty', async () => {
      const { hgetall } = require('ioredis')();
      hgetall.mockResolvedValueOnce({});
      mockChatRepository.count.mockResolvedValue(5);

      const result = await service.getUnreadCount(1);

      expect(result).toBe(5);
    });
  });

  describe('getUnreadCountFrom', () => {
    it('should return unread count from specific user', async () => {
      const { hget } = require('ioredis')();
      hget.mockResolvedValueOnce('3');

      const result = await service.getUnreadCountFrom(1, 2);

      expect(result).toBe(3);
    });

    it('should fallback to database when Redis key not found', async () => {
      mockChatRepository.count.mockResolvedValue(2);

      const result = await service.getUnreadCountFrom(1, 2);

      expect(result).toBe(2);
    });
  });

  describe('markAsRead', () => {
    it('should mark messages as read', async () => {
      mockChatRepository.update.mockResolvedValue({ affected: 3 });

      await service.markAsRead(1, 2);

      expect(mockChatRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          sender_id: '2',
          receiver_id: '1',
          is_read: false,
          target_type: ChatTargetType.PRIVATE,
        }),
        { is_read: true },
      );
    });
  });

  describe('getRecentChats', () => {
    it('should return recent chats list', async () => {
      const rawMessages = [
        {
          sender_id: '2',
          receiver_id: '1',
          last_content: 'Hello',
          message_type: ChatMessageType.TEXT,
          last_message_time: new Date(),
        },
        {
          sender_id: '1',
          receiver_id: '3',
          last_content: 'Hi there',
          message_type: ChatMessageType.TEXT,
          last_message_time: new Date(Date.now() - 3600000),
        },
      ];

      mockChatRepository.createQueryBuilder().getRawMany = jest
        .fn()
        .mockResolvedValue(rawMessages);

      mockChatRepository.query = jest.fn().mockResolvedValue([
        { username: 'user2', nickname: 'User2', avatar_url: '' },
        { username: 'user3', nickname: 'User3', avatar_url: '' },
      ]);

      const result = await service.getRecentChats(1);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return empty array when no recent chats', async () => {
      mockChatRepository.createQueryBuilder().getRawMany = jest
        .fn()
        .mockResolvedValue([]);

      const result = await service.getRecentChats(1);

      expect(result).toEqual([]);
    });
  });

  describe('recallMessage', () => {
    it('should recall message within 2 minutes', async () => {
      const mockMessage = {
        message_id: '1',
        sender_id: '1',
        content: 'Hello',
        message_type: ChatMessageType.TEXT,
        created_at: new Date(),
      };

      mockChatRepository.findOne.mockResolvedValue(mockMessage);
      mockChatRepository.save.mockResolvedValue({
        ...mockMessage,
        content: '[Message recalled]',
        message_type: ChatMessageType.SYSTEM,
      });

      await service.recallMessage(1, '1');

      expect(mockChatRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '[Message recalled]',
          message_type: ChatMessageType.SYSTEM,
        }),
      );
    });

    it('should throw BadRequestException when message not found', async () => {
      mockChatRepository.findOne.mockResolvedValue(null);

      await expect(service.recallMessage(1, 'nonexistent')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException when recalling others message', async () => {
      mockChatRepository.findOne.mockResolvedValue({
        message_id: '1',
        sender_id: '2',
        content: 'Hello',
        created_at: new Date(),
      });

      await expect(service.recallMessage(1, '1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException when message too old', async () => {
      mockChatRepository.findOne.mockResolvedValue({
        message_id: '1',
        sender_id: '1',
        content: 'Hello',
        created_at: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      });

      await expect(service.recallMessage(1, '1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
