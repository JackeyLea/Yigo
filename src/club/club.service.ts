import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { Club, ClubMember, ClubRole, ClubApplication, ApplicationStatus, ClubRoom, RoomStatus } from './entities';
import { CreateClubDto, JoinApplicationDto, ApproveApplicationDto, CreateRoomDto, DonateDto, RoomConfigDto } from './dto';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ClubInfo {
  clubId: string;
  name: string;
  description: string;
  avatar: string;
  ownerId: number;
  memberCount: number;
  maxMembers: number;
  activityScore: number;
  level: number;
  createdAt: Date;
}

export interface MemberInfo {
  userId: number;
  username: string;
  avatarUrl: string;
  role: ClubRole;
  joinedAt: Date;
  activityScore: number;
  lastActiveAt: Date;
}

export interface RoomInfo {
  roomId: string;
  clubId: string;
  creatorId: number;
  name: string;
  gameType: string;
  maxPlayers: number;
  currentPlayers: number;
  status: RoomStatus;
  config: Record<string, any>;
  createdAt: Date;
}

@Injectable()
export class ClubService {
  private readonly CLUB_COST = 10000;
  private readonly MIN_VIP_LEVEL = 3;
  private readonly MAX_CLUBS_PER_USER = 3;
  private readonly DEFAULT_PAGE_SIZE = 20;

  constructor(
    @InjectRepository(Club)
    private readonly clubRepository: Repository<Club>,
    @InjectRepository(ClubMember)
    private readonly memberRepository: Repository<ClubMember>,
    @InjectRepository(ClubApplication)
    private readonly applicationRepository: Repository<ClubApplication>,
    @InjectRepository(ClubRoom)
    private readonly roomRepository: Repository<ClubRoom>,
    @InjectRedis()
    private readonly redis: Redis,
  ) {}

  /**
   * 创建俱乐部
   * 需要10000金币 + VIP L3以上
   */
  async createClub(userId: number, dto: CreateClubDto): Promise<ClubInfo> {
    // 检查金币是否充足
    const balance = await this.getUserBalance(userId);
    if (balance < this.CLUB_COST) {
      throw new BadRequestException(`Insufficient coins. Need ${this.CLUB_COST} coins to create a club`);
    }

    // 检查VIP等级
    const vipLevel = await this.getUserVipLevel(userId);
    if (vipLevel < this.MIN_VIP_LEVEL) {
      throw new BadRequestException(`VIP L${this.MIN_VIP_LEVEL}+ required to create a club`);
    }

    // 检查用户是否已创建/加入3个俱乐部
    const joinedCount = await this.memberRepository.count({ where: { userId } });
    if (joinedCount >= this.MAX_CLUBS_PER_USER) {
      throw new BadRequestException(`You can only join up to ${this.MAX_CLUBS_PER_USER} clubs`);
    }

    // 扣金币
    await this.deductCoins(userId, this.CLUB_COST);

    // 创建俱乐部
    const club = this.clubRepository.create({
      name: dto.name,
      description: dto.description || '',
      avatar: dto.avatar || '',
      ownerId: userId,
      memberCount: 1,
      maxMembers: 100,
      activityScore: 0,
      level: 1,
    });

    const savedClub = await this.clubRepository.save(club);

    // 创建会长成员记录
    const member = this.memberRepository.create({
      clubId: savedClub.clubId,
      userId,
      role: ClubRole.OWNER,
      activityScore: 0,
      lastActiveAt: new Date(),
    });
    await this.memberRepository.save(member);

    // 更新Redis缓存
    await this.redis.hset(`club:${savedClub.clubId}`, {
      clubId: savedClub.clubId,
      name: savedClub.name,
      memberCount: '1',
      activityScore: '0',
      level: '1',
    });
    await this.redis.sadd(`user:${userId}:clubs`, savedClub.clubId);

    return this.toClubInfo(savedClub);
  }

  /**
   * 申请加入俱乐部
   */
  async applyToJoin(userId: number, dto: JoinApplicationDto): Promise<void> {
    const { clubId, message } = dto;

    const club = await this.clubRepository.findOne({ where: { clubId } });
    if (!club) {
      throw new NotFoundException('Club not found');
    }

    // 检查是否已满
    if (club.memberCount >= club.maxMembers) {
      throw new BadRequestException('Club is full');
    }

    // 检查是否已是成员
    const existingMember = await this.memberRepository.findOne({
      where: { clubId, userId },
    });
    if (existingMember) {
      throw new ConflictException('You are already a member of this club');
    }

    // 检查是否有待处理申请
    const existingApp = await this.applicationRepository.findOne({
      where: { clubId, userId, status: ApplicationStatus.PENDING },
    });
    if (existingApp) {
      throw new ConflictException('You already have a pending application');
    }

    // 检查用户已加入的俱乐部数量
    const joinedCount = await this.memberRepository.count({ where: { userId } });
    if (joinedCount >= this.MAX_CLUBS_PER_USER) {
      throw new BadRequestException(`You can only join up to ${this.MAX_CLUBS_PER_USER} clubs`);
    }

    const application = this.applicationRepository.create({
      clubId,
      userId,
      message: message || '',
      status: ApplicationStatus.PENDING,
    });
    await this.applicationRepository.save(application);
  }

  /**
   * 审批申请
   */
  async approveApplication(adminId: number, dto: ApproveApplicationDto): Promise<void> {
    const { clubId, applicantId } = dto;

    const club = await this.clubRepository.findOne({ where: { clubId } });
    if (!club) {
      throw new NotFoundException('Club not found');
    }

    // 检查操作者权限
    const adminMember = await this.memberRepository.findOne({
      where: { clubId, userId: adminId },
    });
    if (!adminMember || (adminMember.role !== ClubRole.OWNER && adminMember.role !== ClubRole.ADMIN)) {
      throw new ForbiddenException('Only club owner or admin can approve applications');
    }

    const application = await this.applicationRepository.findOne({
      where: { clubId, userId: applicantId, status: ApplicationStatus.PENDING },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }

    // 检查俱乐部是否已满
    if (club.memberCount >= club.maxMembers) {
      throw new BadRequestException('Club is full');
    }

    // 更新申请状态
    application.status = ApplicationStatus.APPROVED;
    application.handledBy = adminId;
    application.handledAt = new Date();
    await this.applicationRepository.save(application);

    // 添加成员
    const member = this.memberRepository.create({
      clubId,
      userId: applicantId,
      role: ClubRole.MEMBER,
      activityScore: 0,
      lastActiveAt: new Date(),
    });
    await this.memberRepository.save(member);

    // 更新俱乐部成员数
    club.memberCount += 1;
    await this.clubRepository.save(club);

    // 更新Redis
    await this.redis.hincrby(`club:${clubId}`, 'memberCount', 1);
    await this.redis.sadd(`user:${applicantId}:clubs`, clubId);
    await this.redis.sadd(`club:${clubId}:members`, applicantId.toString());
  }

  /**
   * 拒绝申请
   */
  async rejectApplication(adminId: number, dto: ApproveApplicationDto): Promise<void> {
    const { clubId, applicantId } = dto;

    const adminMember = await this.memberRepository.findOne({
      where: { clubId, userId: adminId },
    });
    if (!adminMember || (adminMember.role !== ClubRole.OWNER && adminMember.role !== ClubRole.ADMIN)) {
      throw new ForbiddenException('Only club owner or admin can reject applications');
    }

    const application = await this.applicationRepository.findOne({
      where: { clubId, userId: applicantId, status: ApplicationStatus.PENDING },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }

    application.status = ApplicationStatus.REJECTED;
    application.handledBy = adminId;
    application.handledAt = new Date();
    await this.applicationRepository.save(application);
  }

  /**
   * 退出俱乐部
   */
  async leaveClub(clubId: string, userId: number): Promise<void> {
    const member = await this.memberRepository.findOne({
      where: { clubId, userId },
    });
    if (!member) {
      throw new NotFoundException('You are not a member of this club');
    }

    // 会长不能退出，必须先转让会长
    if (member.role === ClubRole.OWNER) {
      throw new BadRequestException('Club owner cannot leave. Transfer ownership first.');
    }

    await this.memberRepository.remove(member);

    // 更新俱乐部成员数
    const club = await this.clubRepository.findOne({ where: { clubId } });
    if (club) {
      club.memberCount = Math.max(0, club.memberCount - 1);
      await this.clubRepository.save(club);
    }

    // 更新Redis
    await this.redis.hincrby(`club:${clubId}`, 'memberCount', -1);
    await this.redis.srem(`user:${userId}:clubs`, clubId);
    await this.redis.srem(`club:${clubId}:members`, userId.toString());
  }

  /**
   * 踢出成员
   */
  async kickMember(clubId: string, memberId: number, adminId: number): Promise<void> {
    const adminMember = await this.memberRepository.findOne({
      where: { clubId, userId: adminId },
    });
    if (!adminMember || (adminMember.role !== ClubRole.OWNER && adminMember.role !== ClubRole.ADMIN)) {
      throw new ForbiddenException('Only club owner or admin can kick members');
    }

    const targetMember = await this.memberRepository.findOne({
      where: { clubId, userId: memberId },
    });
    if (!targetMember) {
      throw new NotFoundException('Member not found');
    }

    // 不能踢出会长
    if (targetMember.role === ClubRole.OWNER) {
      throw new ForbiddenException('Cannot kick the club owner');
    }

    // 管理员不能踢出其他管理员（只有会长可以）
    if (targetMember.role === ClubRole.ADMIN && adminMember.role !== ClubRole.OWNER) {
      throw new ForbiddenException('Only owner can kick admins');
    }

    await this.memberRepository.remove(targetMember);

    const club = await this.clubRepository.findOne({ where: { clubId } });
    if (club) {
      club.memberCount = Math.max(0, club.memberCount - 1);
      await this.clubRepository.save(club);
    }

    // 更新Redis
    await this.redis.hincrby(`club:${clubId}`, 'memberCount', -1);
    await this.redis.srem(`user:${memberId}:clubs`, clubId);
    await this.redis.srem(`club:${clubId}:members`, memberId.toString());
  }

  /**
   * 获取俱乐部信息
   */
  async getClub(clubId: string): Promise<ClubInfo> {
    // 先查Redis缓存
    const cached = await this.redis.hgetall(`club:${clubId}`);
    if (cached && cached.clubId) {
      return {
        clubId: cached.clubId,
        name: cached.name,
        description: cached.description || '',
        avatar: cached.avatar || '',
        ownerId: parseInt(cached.ownerId),
        memberCount: parseInt(cached.memberCount),
        maxMembers: parseInt(cached.maxMembers),
        activityScore: parseInt(cached.activityScore),
        level: parseInt(cached.level),
        createdAt: new Date(cached.createdAt),
      };
    }

    const club = await this.clubRepository.findOne({ where: { clubId } });
    if (!club) {
      throw new NotFoundException('Club not found');
    }

    // 回填缓存
    await this.redis.hset(`club:${clubId}`, {
      clubId: club.clubId,
      name: club.name,
      description: club.description || '',
      avatar: club.avatar || '',
      ownerId: club.ownerId.toString(),
      memberCount: club.memberCount.toString(),
      maxMembers: club.maxMembers.toString(),
      activityScore: club.activityScore.toString(),
      level: club.level.toString(),
      createdAt: club.createdAt.toISOString(),
    });

    return this.toClubInfo(club);
  }

  /**
   * 获取俱乐部成员列表
   */
  async getMembers(clubId: string, page = 1): Promise<PaginatedResult<MemberInfo>> {
    const pageSize = this.DEFAULT_PAGE_SIZE;
    const [members, total] = await this.memberRepository.findAndCount({
      where: { clubId },
      order: { role: 'ASC', joinedAt: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // 获取用户信息（这里简化处理，实际可能从用户服务获取）
    const items = await Promise.all(
      members.map(async (m) => this.toMemberInfo(m)),
    );

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取俱乐部列表（支持搜索）
   */
  async listClubs(keyword?: string, page = 1): Promise<PaginatedResult<ClubInfo>> {
    const pageSize = this.DEFAULT_PAGE_SIZE;
    const where = keyword ? { name: Like(`%${keyword}%`) } : {};

    const [clubs, total] = await this.clubRepository.findAndCount({
      where,
      order: { activityScore: 'DESC', memberCount: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items: clubs.map((c) => this.toClubInfo(c)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 创建俱乐部房间
   */
  async createClubRoom(userId: number, dto: CreateRoomDto): Promise<RoomInfo> {
    const { clubId, name, gameType, maxPlayers, config } = dto;

    // 检查用户是否是俱乐部成员
    const member = await this.memberRepository.findOne({
      where: { clubId, userId },
    });
    if (!member) {
      throw new ForbiddenException('Only club members can create rooms');
    }

    const room = this.roomRepository.create({
      clubId,
      creatorId: userId,
      name,
      gameType,
      maxPlayers: maxPlayers || 2,
      currentPlayers: 0,
      status: RoomStatus.WAITING,
      config: config || {},
    });

    const savedRoom = await this.roomRepository.save(room);

    // 更新Redis
    await this.redis.hset(`club:room:${savedRoom.roomId}`, {
      roomId: savedRoom.roomId,
      clubId,
      creatorId: userId.toString(),
      name,
      gameType,
      status: RoomStatus.WAITING,
    });
    await this.redis.sadd(`club:${clubId}:rooms`, savedRoom.roomId);

    return this.toRoomInfo(savedRoom);
  }

  /**
   * 俱乐部排行榜
   */
  async getClubLeaderboard(clubId: string, type: 'week' | 'month' | 'all'): Promise<MemberInfo[]> {
    const club = await this.clubRepository.findOne({ where: { clubId } });
    if (!club) {
      throw new NotFoundException('Club not found');
    }

    let dateFilter: Date | undefined;
    const now = new Date();

    if (type === 'week') {
      dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (type === 'month') {
      dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }

    const query = this.memberRepository
      .createQueryBuilder('member')
      .where('member.clubId = :clubId', { clubId })
      .orderBy('member.activityScore', 'DESC')
      .limit(50);

    if (dateFilter) {
      query.andWhere('member.lastActiveAt >= :dateFilter', { dateFilter });
    }

    const members = await query.getMany();

    return Promise.all(members.map((m) => this.toMemberInfo(m)));
  }

  /**
   * 捐赠（增加俱乐部活跃度）
   */
  async donate(userId: number, dto: DonateDto): Promise<void> {
    const { clubId, amount } = dto;

    if (amount < 1) {
      throw new BadRequestException('Donation amount must be at least 1');
    }

    const member = await this.memberRepository.findOne({
      where: { clubId, userId },
    });
    if (!member) {
      throw new ForbiddenException('Only club members can donate');
    }

    // 检查用户余额
    const balance = await this.getUserBalance(userId);
    if (balance < amount) {
      throw new BadRequestException('Insufficient coins');
    }

    // 扣除金币
    await this.deductCoins(userId, amount);

    // 增加个人贡献
    member.activityScore += amount;
    member.lastActiveAt = new Date();
    await this.memberRepository.save(member);

    // 增加俱乐部活跃度和总捐赠
    const club = await this.clubRepository.findOne({ where: { clubId } });
    if (club) {
      club.activityScore += amount;
      club.totalDonations += amount;

      // 检查升级
      const newLevel = this.calculateLevel(club.activityScore);
      if (newLevel > club.level) {
        const prevMax = club.maxMembers;
        club.level = newLevel;
        club.maxMembers = this.getMaxMembersByLevel(newLevel);
        // 升级通知可以在这里触发
      }

      await this.clubRepository.save(club);

      // 更新Redis
      await this.redis.hincrby(`club:${clubId}`, 'activityScore', amount);
      await this.redis.hset(`club:${clubId}`, 'level', club.level.toString());
      await this.redis.hset(`club:${clubId}`, 'maxMembers', club.maxMembers.toString());
    }

    // 记录捐赠事件
    await this.redis.xadd(
      'club:donations',
      '*',
      ...Object.entries({
        clubId,
        userId: userId.toString(),
        amount: amount.toString(),
      }).flat(),
    );
  }

  /**
   * 转让会长
   */
  async transferOwnership(clubId: string, ownerId: number, newOwnerId: number): Promise<void> {
    const owner = await this.memberRepository.findOne({
      where: { clubId, userId: ownerId },
    });
    if (!owner || owner.role !== ClubRole.OWNER) {
      throw new ForbiddenException('Only the club owner can transfer ownership');
    }

    const newOwner = await this.memberRepository.findOne({
      where: { clubId, userId: newOwnerId },
    });
    if (!newOwner) {
      throw new NotFoundException('Target member not found in club');
    }

    // 更新角色
    owner.role = ClubRole.ADMIN;
    newOwner.role = ClubRole.OWNER;
    await this.memberRepository.save([owner, newOwner]);

    // 更新俱乐部ownerId
    await this.clubRepository.update({ clubId }, { ownerId: newOwnerId });

    // 更新Redis
    await this.redis.hset(`club:${clubId}`, 'ownerId', newOwnerId.toString());
  }

  /**
   * 设置管理员
   */
  async setAdmin(clubId: string, ownerId: number, memberId: number): Promise<void> {
    const owner = await this.memberRepository.findOne({
      where: { clubId, userId: ownerId },
    });
    if (!owner || owner.role !== ClubRole.OWNER) {
      throw new ForbiddenException('Only the club owner can set admins');
    }

    const member = await this.memberRepository.findOne({
      where: { clubId, userId: memberId },
    });
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    member.role = ClubRole.ADMIN;
    await this.memberRepository.save(member);
  }

  // ===== 内部方法 =====

  private calculateLevel(activityScore: number): number {
    // 活跃度等级计算公式
    if (activityScore >= 500000) return 10;
    if (activityScore >= 300000) return 9;
    if (activityScore >= 150000) return 8;
    if (activityScore >= 80000) return 7;
    if (activityScore >= 40000) return 6;
    if (activityScore >= 20000) return 5;
    if (activityScore >= 10000) return 4;
    if (activityScore >= 5000) return 3;
    if (activityScore >= 2000) return 2;
    return 1;
  }

  private getMaxMembersByLevel(level: number): number {
    const map: Record<number, number> = {
      1: 100,
      2: 110,
      3: 125,
      4: 145,
      5: 170,
      6: 200,
      7: 240,
      8: 290,
      9: 350,
      10: 500,
    };
    return map[level] || 100;
  }

  private async getUserBalance(userId: number): Promise<number> {
    const balance = await this.redis.get(`user:${userId}:coins`);
    return balance ? parseInt(balance) : 0;
  }

  private async getUserVipLevel(userId: number): Promise<number> {
    const vip = await this.redis.get(`user:${userId}:vip`);
    return vip ? parseInt(vip) : 0;
  }

  private async deductCoins(userId: number, amount: number): Promise<void> {
    const result = await this.redis.decrby(`user:${userId}:coins`, amount);
    if (result < 0) {
      // 回滚
      await this.redis.incrby(`user:${userId}:coins`, amount);
      throw new BadRequestException('Insufficient coins');
    }
  }

  private async toMemberInfo(member: ClubMember): Promise<MemberInfo> {
    // 从Redis或用户服务获取用户信息
    const username = await this.redis.hget(`user:${member.userId}`, 'username');
    const avatarUrl = await this.redis.hget(`user:${member.userId}`, 'avatar');

    return {
      userId: member.userId,
      username: username || `User_${member.userId}`,
      avatarUrl: avatarUrl || '',
      role: member.role,
      joinedAt: member.joinedAt,
      activityScore: member.activityScore,
      lastActiveAt: member.lastActiveAt || member.joinedAt,
    };
  }

  private toClubInfo(club: Club): ClubInfo {
    return {
      clubId: club.clubId,
      name: club.name,
      description: club.description || '',
      avatar: club.avatar || '',
      ownerId: club.ownerId,
      memberCount: club.memberCount,
      maxMembers: club.maxMembers,
      activityScore: club.activityScore,
      level: club.level,
      createdAt: club.createdAt,
    };
  }

  private toRoomInfo(room: ClubRoom): RoomInfo {
    return {
      roomId: room.roomId,
      clubId: room.clubId,
      creatorId: room.creatorId,
      name: room.name,
      gameType: room.gameType,
      maxPlayers: room.maxPlayers,
      currentPlayers: room.currentPlayers,
      status: room.status,
      config: room.config || {},
      createdAt: room.createdAt,
    };
  }
}
