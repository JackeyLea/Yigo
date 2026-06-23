import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User, UserStatus } from '../common/entities/user.entity';
import { CurrentUserData } from '../common/decorators/current-user.decorator';

describe('UserController', () => {
  let controller: UserController;

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

  const mockUserService = {
    findById: jest.fn(),
    updateProfile: jest.fn(),
    getUserStats: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  describe('getUserById', () => {
    it('should return user by id', async () => {
      mockUserService.findById.mockResolvedValue(mockUser);

      const result = await controller.getUserById(1);

      expect(result).toBeDefined();
      expect(result.username).toBe('testuser');
      expect(mockUserService.findById).toHaveBeenCalledWith(1);
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      const updatedUser = { ...mockUser, nickname: 'NewNick' };
      mockUserService.updateProfile.mockResolvedValue(updatedUser);

      const currentUser: CurrentUserData = { userId: 1, username: 'testuser' };
      const result = await controller.updateProfile(currentUser, {
        nickname: 'NewNick',
      });

      expect(result.nickname).toBe('NewNick');
      expect(mockUserService.updateProfile).toHaveBeenCalledWith(1, {
        nickname: 'NewNick',
      });
    });
  });

  describe('getUserStats', () => {
    it('should return user stats', async () => {
      const stats = {
        userId: 1,
        username: 'testuser',
        totalGames: 10,
        wins: 5,
        losses: 3,
        draws: 2,
        winRate: 50,
        totalPoints: 1000,
        rank: 1,
        level: 5,
        xp: 1000,
      };
      mockUserService.getUserStats.mockResolvedValue(stats);

      const result = await controller.getUserStats(1);

      expect(result.userId).toBe(1);
      expect(result.totalGames).toBe(10);
    });
  });
});
