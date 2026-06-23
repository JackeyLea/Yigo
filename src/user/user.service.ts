import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../common/entities/user.entity';
import { Wallet } from '../common/entities/wallet.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserStats } from '../common/interfaces/user-stats.interface';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
  ) {}

  async findById(userId: number): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { user_id: String(userId) },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    return user;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { username },
    });
  }

  async findByUsernameWithPassword(username: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .where('user.username = :username', { username })
      .getOne();
  }

  async updateProfile(
    userId: number,
    dto: UpdateProfileDto,
  ): Promise<User> {
    const user = await this.findById(userId);

    if (dto.nickname !== undefined) {
      user.nickname = dto.nickname;
    }
    if (dto.avatarUrl !== undefined) {
      user.avatar_url = dto.avatarUrl;
    }

    await this.userRepository.save(user);
    this.logger.log(`User ${userId} profile updated`);
    return user;
  }

  async getUserStats(userId: number): Promise<UserStats> {
    const user = await this.findById(userId);

    // Get wallet balances
    const wallets = await this.walletRepository.find({
      where: { user_id: String(userId) },
    });

    const totalPoints = wallets.reduce((sum, w) => {
      return sum + parseFloat(w.balance);
    }, 0);

    // Placeholder stats - in production these would come from game-record aggregation
    const stats: UserStats = {
      userId,
      username: user.username,
      totalGames: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
      totalPoints,
      rank: 0,
      level: user.level,
      xp: parseInt(user.xp, 10),
    };

    return stats;
  }

  async createDefaultWallet(userId: string): Promise<Wallet> {
    const wallet = this.walletRepository.create({
      user_id: userId,
      currency: 'POINT',
      balance: '0',
      frozen: '0',
      total_deposited: '0',
      total_withdrawn: '0',
    });
    return this.walletRepository.save(wallet);
  }

  async checkUsernameExists(username: string): Promise<boolean> {
    const count = await this.userRepository.count({ where: { username } });
    return count > 0;
  }

  async checkEmailExists(email: string): Promise<boolean> {
    const count = await this.userRepository.count({ where: { email } });
    return count > 0;
  }
}
