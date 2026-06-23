import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { User, UserStatus } from '../common/entities/user.entity';
import { TokenResponseDto } from './dto/token-response.dto';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refreshToken: jest.fn(),
  };

  const mockUserService = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('should register a new user', async () => {
      const dto: RegisterDto = {
        username: 'testuser',
        password: 'password123',
        email: 'test@test.com',
      };

      const mockUser: Partial<User> = {
        user_id: '1',
        username: 'testuser',
        email: 'test@test.com',
        nickname: 'TestUser',
        level: 1,
        status: UserStatus.ACTIVE,
      };

      mockAuthService.register.mockResolvedValue(mockUser);

      const result = await controller.register(dto);

      expect(result.user_id).toBe('1');
      expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    });
  });

  describe('login', () => {
    it('should login and return tokens', async () => {
      const dto: LoginDto = {
        username: 'testuser',
        password: 'password123',
      };

      const tokenResponse: TokenResponseDto = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: {
          userId: 1,
          username: 'testuser',
          nickname: 'Test',
          level: 1,
        },
      };

      mockAuthService.login.mockResolvedValue(tokenResponse);

      const result = await controller.login(dto);

      expect(result.accessToken).toBe('mock-access-token');
      expect(mockAuthService.login).toHaveBeenCalledWith(dto);
    });
  });

  describe('refresh', () => {
    it('should refresh token', async () => {
      const tokenResponse: TokenResponseDto = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
        user: {
          userId: 1,
          username: 'testuser',
          nickname: 'Test',
          level: 1,
        },
      };

      mockAuthService.refreshToken.mockResolvedValue(tokenResponse);

      const result = await controller.refresh({ refreshToken: 'old-token' });

      expect(result.accessToken).toBe('new-access-token');
      expect(mockAuthService.refreshToken).toHaveBeenCalledWith('old-token');
    });
  });

  describe('getMe', () => {
    it('should return current user info', async () => {
      const mockUser: Partial<User> = {
        user_id: '1',
        username: 'testuser',
        nickname: 'Test',
        level: 5,
      };

      mockUserService.findById.mockResolvedValue(mockUser);

      const result = await controller.getMe({ userId: 1, username: 'testuser' });

      expect(result.username).toBe('testuser');
      expect(mockUserService.findById).toHaveBeenCalledWith(1);
    });
  });
});
