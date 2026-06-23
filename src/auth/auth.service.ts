import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import * as fs from 'fs';
import * as path from 'path';
import { User, UserStatus } from '../common/entities/user.entity';
import { Wallet } from '../common/entities/wallet.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly jwtExpiration: number;
  private readonly jwtRefreshExpiration: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly dataSource: DataSource,
  ) {
    const keysDir = process.env.JWT_KEYS_DIR || './keys';
    this.privateKey = fs.readFileSync(
      path.join(keysDir, 'jwt-private.pem'),
      'utf8',
    );
    this.publicKey = fs.readFileSync(
      path.join(keysDir, 'jwt-public.pem'),
      'utf8',
    );
    this.jwtExpiration = this.parseExpiration(
      this.configService.get<string>('JWT_EXPIRATION', '1h'),
    );
    this.jwtRefreshExpiration = this.parseExpiration(
      this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d'),
    );
  }

  private parseExpiration(exp: string): number {
    const match = exp.match(/^(\d+)([smhd])$/);
    if (!match) return 3600;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return value * (multipliers[unit] || 3600);
  }

  /**
   * Hash password using argon2id
   * Memory: 64MB, Iterations: 3, Parallelism: 4
   */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64MB
      timeCost: 3,
      parallelism: 4,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  /**
   * Register a new user with argon2id password hash and default wallet
   */
  async register(dto: RegisterDto): Promise<User> {
    // Check if username already exists
    const existingUser = await this.userService.findByUsername(dto.username);
    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    // Check if email already exists
    if (dto.email) {
      const emailExists = await this.userService.checkEmailExists(dto.email);
      if (emailExists) {
        throw new ConflictException('Email already in use');
      }
    }

    // Hash password with argon2id
    const passwordHash = await this.hashPassword(dto.password);

    // Create user and default wallet in a transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const userRepository = queryRunner.manager.getRepository(User);
      const walletRepository = queryRunner.manager.getRepository(Wallet);

      // Create user
      const user = userRepository.create({
        username: dto.username,
        password_hash: passwordHash,
        email: dto.email || null,
        nickname: dto.nickname || dto.username,
        level: 1,
        xp: '0',
        status: UserStatus.ACTIVE,
        avatar_url: null,
        phone: null,
        last_login_at: null,
      });

      const savedUser = await userRepository.save(user);

      // Create default wallet (POINT currency)
      const wallet = walletRepository.create({
        user_id: savedUser.user_id,
        currency: 'POINT',
        balance: '0',
        frozen: '0',
        total_deposited: '0',
        total_withdrawn: '0',
      });

      await walletRepository.save(wallet);

      await queryRunner.commitTransaction();

      this.logger.log(`User registered: ${dto.username} (ID: ${savedUser.user_id})`);

      // Remove password_hash from returned user
      const { password_hash: _, ...result } = savedUser as User & { password_hash?: string };
      void _;
      return savedUser;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Registration failed for ${dto.username}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Registration failed');
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Login with username and password
   */
  async login(dto: LoginDto): Promise<TokenResponseDto> {
    const user = await this.validateUser(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    if (user.status === UserStatus.BANNED) {
      throw new UnauthorizedException('Account has been banned');
    }

    // Update last login time
    user.last_login_at = new Date();
    await this.userService['userRepository'].save(user);

    const tokens = await this.generateTokens(user);

    this.logger.log(`User logged in: ${dto.username}`);

    return {
      ...tokens,
      user: {
        userId: Number(user.user_id),
        username: user.username,
        nickname: user.nickname,
        level: user.level,
      },
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponseDto> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.privateKey,
        algorithms: ['RS256'],
      });

      const user = await this.userService.findById(Number(payload.sub));
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      if (user.status === UserStatus.BANNED) {
        throw new UnauthorizedException('Account has been banned');
      }

      const tokens = await this.generateTokens(user);

      return {
        ...tokens,
        user: {
          userId: Number(user.user_id),
          username: user.username,
          nickname: user.nickname,
          level: user.level,
        },
      };
    } catch (error) {
      this.logger.warn(`Token refresh failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /**
   * Validate user credentials
   */
  async validateUser(
    username: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.userService.findByUsernameWithPassword(username);
    if (!user) {
      return null;
    }

    const isValid = await this.verifyPassword(user.password_hash, password);
    if (!isValid) {
      return null;
    }

    return user;
  }

  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(user: User): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const payload = {
      sub: user.user_id,
      username: user.username,
    };

    const accessToken = this.jwtService.sign(payload, {
      privateKey: this.privateKey,
      algorithm: 'RS256',
      expiresIn: this.jwtExpiration,
    });

    const refreshToken = this.jwtService.sign(payload, {
      privateKey: this.privateKey,
      algorithm: 'RS256',
      expiresIn: this.jwtRefreshExpiration,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.jwtExpiration,
    };
  }

  getPublicKey(): string {
    return this.publicKey;
  }
}
