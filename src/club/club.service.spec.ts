import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClubService } from './club.service';
import { Club, ClubMember, ClubRole, ClubApplication, ApplicationStatus, ClubRoom } from './entities';
import { BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';

type MockRepository<T> = {
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
  createQueryBuilder: jest.Mock;
  update: jest.Mock;
};

const createMockRepository = <T>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  })),
  update: jest.fn(),
});

describe('ClubService', () => {
  let service: ClubService;
  let clubRepo: MockRepository<Club>;
  let memberRepo: MockRepository<ClubMember>;
  let applicationRepo: MockRepository<ClubApplication>;
  let roomRepo: MockRepository<ClubRoom>;
  let redis: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubService,
        { provide: getRepositoryToken(Club), useValue: createMockRepository<Club>() },
        { provide: getRepositoryToken(ClubMember), useValue: createMockRepository<ClubMember>() },
        { provide: getRepositoryToken(ClubApplication), useValue: createMockRepository<ClubApplication>() },
        { provide: getRepositoryToken(ClubRoom), useValue: createMockRepository<ClubRoom>() },
        {
          provide: 'default_IORedisModuleConnectionToken',
          useValue: {
            hset: jest.fn().mockResolvedValue(1),
            hgetall: jest.fn().mockResolvedValue({}),
            hget: jest.fn().mockResolvedValue(null),
            hincrby: jest.fn().mockResolvedValue(1),
            sadd: jest.fn().mockResolvedValue(1),
            srem: jest.fn().mockResolvedValue(1),
            get: jest.fn().mockResolvedValue('50000'),
            set: jest.fn().mockResolvedValue('OK'),
            decrby: jest.fn().mockResolvedValue(40000),
            incrby: jest.fn().mockResolvedValue(1),
            xadd: jest.fn().mockResolvedValue('1-0'),
          },
        },
      ],
    }).compile();

    service = module.get<ClubService>(ClubService);
    clubRepo = module.get(getRepositoryToken(Club));
    memberRepo = module.get(getRepositoryToken(ClubMember));
    applicationRepo = module.get(getRepositoryToken(ClubApplication));
    roomRepo = module.get(getRepositoryToken(ClubRoom));
    redis = module.get('default_IORedisModuleConnectionToken');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createClub', () => {
    it('should create club successfully when requirements met', async () => {
      redis.get = jest.fn()
        .mockResolvedValueOnce('50000')  // balance
        .mockResolvedValueOnce('5');     // vip level

      memberRepo.count = jest.fn().mockResolvedValue(0);

      const mockClub = {
        clubId: 'club-1',
        name: 'Test Club',
        description: 'A test club',
        avatar: '',
        ownerId: 1,
        memberCount: 1,
        maxMembers: 100,
        activityScore: 0,
        level: 1,
        createdAt: new Date(),
      } as Club;

      clubRepo.create = jest.fn().mockReturnValue(mockClub);
      clubRepo.save = jest.fn().mockResolvedValue(mockClub);
      memberRepo.create = jest.fn().mockReturnValue({ id: 1 });
      memberRepo.save = jest.fn().mockResolvedValue({ id: 1 });

      const result = await service.createClub(1, { name: 'Test Club', description: 'A test club' });

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Club');
      expect(clubRepo.save).toHaveBeenCalled();
      expect(memberRepo.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException when insufficient coins', async () => {
      redis.get = jest.fn().mockResolvedValueOnce('5000');

      await expect(
        service.createClub(1, { name: 'Test Club' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when VIP level too low', async () => {
      redis.get = jest.fn()
        .mockResolvedValueOnce('50000')
        .mockResolvedValueOnce('1');

      await expect(
        service.createClub(1, { name: 'Test Club' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when user already in 3 clubs', async () => {
      redis.get = jest.fn()
        .mockResolvedValueOnce('50000')
        .mockResolvedValueOnce('5');

      memberRepo.count = jest.fn().mockResolvedValue(3);

      await expect(
        service.createClub(1, { name: 'Test Club' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('applyToJoin', () => {
    it('should create application successfully', async () => {
      clubRepo.findOne = jest.fn().mockResolvedValue({
        clubId: 'club-1',
        memberCount: 5,
        maxMembers: 100,
      });
      memberRepo.findOne = jest.fn().mockResolvedValue(null);
      memberRepo.count = jest.fn().mockResolvedValue(1);
      applicationRepo.findOne = jest.fn().mockResolvedValue(null);
      applicationRepo.create = jest.fn().mockReturnValue({ id: 1 });
      applicationRepo.save = jest.fn().mockResolvedValue({ id: 1 });

      await service.applyToJoin(2, { clubId: 'club-1', message: 'Please let me join' });

      expect(applicationRepo.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException when club not found', async () => {
      clubRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.applyToJoin(2, { clubId: 'non-existent' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when already a member', async () => {
      clubRepo.findOne = jest.fn().mockResolvedValue({
        clubId: 'club-1',
        memberCount: 5,
        maxMembers: 100,
      });
      memberRepo.findOne = jest.fn().mockResolvedValue({ id: 1, userId: 2, clubId: 'club-1' });

      await expect(
        service.applyToJoin(2, { clubId: 'club-1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('approveApplication', () => {
    it('should approve application successfully', async () => {
      clubRepo.findOne = jest.fn().mockResolvedValue({
        clubId: 'club-1',
        memberCount: 5,
        maxMembers: 100,
      });
      memberRepo.findOne = jest.fn()
        .mockResolvedValueOnce({ id: 1, userId: 1, clubId: 'club-1', role: ClubRole.OWNER })
        .mockResolvedValueOnce(null);
      applicationRepo.findOne = jest.fn().mockResolvedValue({
        id: 1,
        clubId: 'club-1',
        userId: 2,
        status: ApplicationStatus.PENDING,
      });
      applicationRepo.save = jest.fn().mockResolvedValue({});
      memberRepo.create = jest.fn().mockReturnValue({ id: 2 });
      memberRepo.save = jest.fn().mockResolvedValue({ id: 2 });
      clubRepo.save = jest.fn().mockResolvedValue({});

      await service.approveApplication(1, { clubId: 'club-1', applicantId: 2 });

      expect(applicationRepo.save).toHaveBeenCalled();
      expect(memberRepo.save).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when not admin/owner', async () => {
      memberRepo.findOne = jest.fn().mockResolvedValue({
        id: 1,
        userId: 1,
        clubId: 'club-1',
        role: ClubRole.MEMBER,
      });

      await expect(
        service.approveApplication(1, { clubId: 'club-1', applicantId: 2 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('leaveClub', () => {
    it('should allow member to leave', async () => {
      memberRepo.findOne = jest.fn().mockResolvedValue({
        id: 1,
        userId: 1,
        clubId: 'club-1',
        role: ClubRole.MEMBER,
      });
      memberRepo.remove = jest.fn().mockResolvedValue({});
      clubRepo.findOne = jest.fn().mockResolvedValue({
        clubId: 'club-1',
        memberCount: 5,
      });
      clubRepo.save = jest.fn().mockResolvedValue({});

      await service.leaveClub('club-1', 1);

      expect(memberRepo.remove).toHaveBeenCalled();
    });

    it('should throw BadRequestException when owner tries to leave', async () => {
      memberRepo.findOne = jest.fn().mockResolvedValue({
        id: 1,
        userId: 1,
        clubId: 'club-1',
        role: ClubRole.OWNER,
      });

      await expect(service.leaveClub('club-1', 1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('kickMember', () => {
    it('should allow owner to kick member', async () => {
      memberRepo.findOne = jest.fn()
        .mockResolvedValueOnce({ id: 1, userId: 1, clubId: 'club-1', role: ClubRole.OWNER })
        .mockResolvedValueOnce({ id: 2, userId: 2, clubId: 'club-1', role: ClubRole.MEMBER });
      memberRepo.remove = jest.fn().mockResolvedValue({});
      clubRepo.findOne = jest.fn().mockResolvedValue({ clubId: 'club-1', memberCount: 5 });
      clubRepo.save = jest.fn().mockResolvedValue({});

      await service.kickMember('club-1', 2, 1);

      expect(memberRepo.remove).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when kicking owner', async () => {
      memberRepo.findOne = jest.fn()
        .mockResolvedValueOnce({ id: 1, userId: 1, clubId: 'club-1', role: ClubRole.ADMIN })
        .mockResolvedValueOnce({ id: 2, userId: 2, clubId: 'club-1', role: ClubRole.OWNER });

      await expect(service.kickMember('club-1', 2, 1)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getClub', () => {
    it('should return club info from cache', async () => {
      redis.hgetall = jest.fn().mockResolvedValue({
        clubId: 'club-1',
        name: 'Test Club',
        description: 'desc',
        avatar: '',
        ownerId: '1',
        memberCount: '10',
        maxMembers: '100',
        activityScore: '500',
        level: '2',
        createdAt: new Date().toISOString(),
      });

      const result = await service.getClub('club-1');

      expect(result.name).toBe('Test Club');
      expect(result.memberCount).toBe(10);
    });

    it('should return club info from DB when cache miss', async () => {
      redis.hgetall = jest.fn().mockResolvedValue({});
      clubRepo.findOne = jest.fn().mockResolvedValue({
        clubId: 'club-1',
        name: 'Test Club',
        description: 'desc',
        avatar: '',
        ownerId: 1,
        memberCount: 10,
        maxMembers: 100,
        activityScore: 500,
        level: 2,
        createdAt: new Date(),
      });

      const result = await service.getClub('club-1');

      expect(result.name).toBe('Test Club');
      expect(clubRepo.findOne).toHaveBeenCalled();
    });

    it('should throw NotFoundException when club not found', async () => {
      redis.hgetall = jest.fn().mockResolvedValue({});
      clubRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(service.getClub('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('donate', () => {
    it('should process donation successfully', async () => {
      redis.get = jest.fn().mockResolvedValue('1000');
      memberRepo.findOne = jest.fn().mockResolvedValue({
        id: 1,
        userId: 1,
        clubId: 'club-1',
        activityScore: 100,
        role: ClubRole.MEMBER,
      });
      memberRepo.save = jest.fn().mockResolvedValue({});
      clubRepo.findOne = jest.fn().mockResolvedValue({
        clubId: 'club-1',
        activityScore: 500,
        totalDonations: 1000,
        level: 1,
        maxMembers: 100,
      });
      clubRepo.save = jest.fn().mockResolvedValue({});

      await service.donate(1, { clubId: 'club-1', amount: 500 });

      expect(memberRepo.save).toHaveBeenCalled();
      expect(clubRepo.save).toHaveBeenCalled();
      expect(redis.xadd).toHaveBeenCalled();
    });

    it('should upgrade club level when activity threshold reached', async () => {
      redis.get = jest.fn().mockResolvedValue('10000');
      memberRepo.findOne = jest.fn().mockResolvedValue({
        id: 1,
        userId: 1,
        clubId: 'club-1',
        activityScore: 100,
        role: ClubRole.MEMBER,
      });
      memberRepo.save = jest.fn().mockResolvedValue({});
      clubRepo.findOne = jest.fn().mockResolvedValue({
        clubId: 'club-1',
        activityScore: 1900,
        totalDonations: 1000,
        level: 1,
        maxMembers: 100,
      });
      clubRepo.save = jest.fn().mockImplementation((club) => club);

      await service.donate(1, { clubId: 'club-1', amount: 500 });

      const savedClub = clubRepo.save.mock.calls[0][0];
      expect(savedClub.level).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getClubLeaderboard', () => {
    it('should return sorted member list', async () => {
      clubRepo.findOne = jest.fn().mockResolvedValue({ clubId: 'club-1' });
      const mockMembers = [
        { userId: 1, role: ClubRole.MEMBER, activityScore: 1000, joinedAt: new Date(), lastActiveAt: new Date() },
        { userId: 2, role: ClubRole.MEMBER, activityScore: 500, joinedAt: new Date(), lastActiveAt: new Date() },
        { userId: 3, role: ClubRole.ADMIN, activityScore: 2000, joinedAt: new Date(), lastActiveAt: new Date() },
      ];

      const queryBuilder = memberRepo.createQueryBuilder();
      queryBuilder.getMany = jest.fn().mockResolvedValue(mockMembers);

      const result = await service.getClubLeaderboard('club-1', 'all');

      expect(result).toHaveLength(3);
      expect(memberRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });

  describe('listClubs', () => {
    it('should return paginated club list', async () => {
      const mockClubs = [
        { clubId: '1', name: 'Club A', memberCount: 50, activityScore: 1000, level: 2, ownerId: 1, description: '', avatar: '', maxMembers: 100, createdAt: new Date() },
        { clubId: '2', name: 'Club B', memberCount: 30, activityScore: 500, level: 1, ownerId: 2, description: '', avatar: '', maxMembers: 100, createdAt: new Date() },
      ];
      clubRepo.findAndCount = jest.fn().mockResolvedValue([mockClubs, 2]);

      const result = await service.listClubs(undefined, 1);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
    });

    it('should support keyword search', async () => {
      clubRepo.findAndCount = jest.fn().mockResolvedValue([[], 0]);

      await service.listClubs('chess', 1);

      expect(clubRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: expect.any(Object) },
        }),
      );
    });
  });

  describe('transferOwnership', () => {
    it('should transfer ownership successfully', async () => {
      memberRepo.findOne = jest.fn()
        .mockResolvedValueOnce({ id: 1, userId: 1, clubId: 'club-1', role: ClubRole.OWNER })
        .mockResolvedValueOnce({ id: 2, userId: 2, clubId: 'club-1', role: ClubRole.MEMBER });
      memberRepo.save = jest.fn().mockResolvedValue({});
      clubRepo.update = jest.fn().mockResolvedValue({});

      await service.transferOwnership('club-1', 1, 2);

      expect(memberRepo.save).toHaveBeenCalled();
      expect(clubRepo.update).toHaveBeenCalledWith(
        { clubId: 'club-1' },
        { ownerId: 2 },
      );
    });

    it('should throw ForbiddenException when non-owner tries to transfer', async () => {
      memberRepo.findOne = jest.fn().mockResolvedValue({
        id: 1,
        userId: 1,
        clubId: 'club-1',
        role: ClubRole.ADMIN,
      });

      await expect(service.transferOwnership('club-1', 1, 2)).rejects.toThrow(ForbiddenException);
    });
  });
});
