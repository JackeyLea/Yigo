import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserService } from './user.service';
import { User, UserStatus } from '../common/entities/user.entity';
import { Wallet } from '../common/entities/wallet.entity';
import { NotFoundException } from '@nestjs/common';

describe('UserService', () => {
  let service: UserService;
  let userRepository: jest.Mocked<Partial<Repository<User>>>;
  let walletRepository: jest.Mocked<Partial<Repository<Wallet>>>;

  const mockUser: User = {
    user_id: '1',
    username: 'testuser',
    password_hash: 'hashed',
    email: 'test@test.com',
    phone: null,
    avatar_url: null,
    nickname: 'TestUser',
    level: 5,
    xp: '1000',
    status: UserStatus.ACTIVE,
    last_login_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    hosted_rooms: [],
    room_players: [],
    leaderboard_entries: [],
    user_achievements: [],
    transactions: [],
    wallets: [],
  };

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
    };

    walletRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockReturnValue({} as Wallet),
      save: jest.fn().mockResolvedValue({} as Wallet),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(Wallet),
          useValue: walletRepository,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('findById', () => {
    it('should find user by id', async () => {
      userRepository.findOne!.mockResolvedValue(mockUser);

      const result = await service.findById(1);

      expect(result).toBeDefined();
      expect(result.user_id).toBe('1');
    });

    it('should throw NotFoundException for non-existent user', async () => {
      userRepository.findOne!.mockResolvedValue(null);

      await expect(service.findById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByUsername', () => {
    it('should find user by username', async () => {
      userRepository.findOne!.mockResolvedValue(mockUser);

      const result = await service.findByUsername('testuser');

      expect(result).toBeDefined();
      expect(result?.username).toBe('testuser');
    });

    it('should return null for non-existent username', async () => {
      userRepository.findOne!.mockResolvedValue(null);

      const result = await service.findByUsername('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('should update nickname and avatar', async () => {
      userRepository.findOne!.mockResolvedValue({ ...mockUser });
      userRepository.save!.mockResolvedValue({
        ...mockUser,
        nickname: 'NewNick',
        avatar_url: 'http://example.com/avatar.png',
      });

      const result = await service.updateProfile(1, {
        nickname: 'NewNick',
        avatarUrl: 'http://example.com/avatar.png',
      });

      expect(result.nickname).toBe('NewNick');
      expect(result.avatar_url).toBe('http://example.com/avatar.png');
    });
  });

  describe('getUserStats', () => {
    it('should return user stats', async () => {
      userRepository.findOne!.mockResolvedValue(mockUser);
      walletRepository.find!.mockResolvedValue([
        {
          wallet_id: '1',
          user_id: '1',
          currency: 'POINT',
          balance: '1000.0000',
          frozen: '0',
          total_deposited: '1000',
          total_withdrawn: '0',
          updated_at: new Date(),
          user: mockUser,
        },
      ] as Wallet[]);

      const result = await service.getUserStats(1);

      expect(result.userId).toBe(1);
      expect(result.username).toBe('testuser');
      expect(result.level).toBe(5);
    });
  });

  describe('createDefaultWallet', () => {
    it('should create default POINT wallet', async () => {
      const mockWallet = {
        wallet_id: '1',
        user_id: '1',
        currency: 'POINT',
        balance: '0',
      } as Wallet;

      walletRepository.create!.mockReturnValue(mockWallet);
      walletRepository.save!.mockResolvedValue(mockWallet);

      const result = await service.createDefaultWallet('1');

      expect(result.currency).toBe('POINT');
    });
  });

  describe('checkUsernameExists', () => {
    it('should return true if username exists', async () => {
      userRepository.count!.mockResolvedValue(1);

      const result = await service.checkUsernameExists('testuser');

      expect(result).toBe(true);
    });

    it('should return false if username does not exist', async () => {
      userRepository.count!.mockResolvedValue(0);

      const result = await service.checkUsernameExists('newuser');

      expect(result).toBe(false);
    });
  });
});
