import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { AnalyticsService, RetentionData, HourlyStats, ConversionStats, FunnelData, DashboardStats } from './analytics.service';
import { AnalyticsEvent, EventType, RetentionCohort, CohortType, UserLtv, DailyStats } from './entities';

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
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
    getMany: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  })),
  update: jest.fn(),
});

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let eventRepo: MockRepository<AnalyticsEvent>;
  let cohortRepo: MockRepository<RetentionCohort>;
  let ltvRepo: MockRepository<UserLtv>;
  let dailyStatsRepo: MockRepository<DailyStats>;
  let redis: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(AnalyticsEvent), useValue: createMockRepository<AnalyticsEvent>() },
        { provide: getRepositoryToken(RetentionCohort), useValue: createMockRepository<RetentionCohort>() },
        { provide: getRepositoryToken(UserLtv), useValue: createMockRepository<UserLtv>() },
        { provide: getRepositoryToken(DailyStats), useValue: createMockRepository<DailyStats>() },
        {
          provide: 'default_IORedisModuleConnectionToken',
          useValue: {
            pfadd: jest.fn().mockResolvedValue(1),
            pfcount: jest.fn().mockResolvedValue(0),
            hincrby: jest.fn().mockResolvedValue(1),
            hincrbyfloat: jest.fn().mockResolvedValue('1.0'),
            hset: jest.fn().mockResolvedValue(1),
            hget: jest.fn().mockResolvedValue(null),
            hgetall: jest.fn().mockResolvedValue({}),
            hdel: jest.fn().mockResolvedValue(1),
            sadd: jest.fn().mockResolvedValue(1),
            srem: jest.fn().mockResolvedValue(1),
            smembers: jest.fn().mockResolvedValue([]),
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
            xadd: jest.fn().mockResolvedValue('1-0'),
            xread: jest.fn().mockResolvedValue(null),
            xdel: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
            pipeline: jest.fn(() => ({
              exec: jest.fn().mockResolvedValue([]),
            })),
          },
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    eventRepo = module.get(getRepositoryToken(AnalyticsEvent));
    cohortRepo = module.get(getRepositoryToken(RetentionCohort));
    ltvRepo = module.get(getRepositoryToken(UserLtv));
    dailyStatsRepo = module.get(getRepositoryToken(DailyStats));
    redis = module.get('default_IORedisModuleConnectionToken');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('trackEvent', () => {
    it('should track event and update DAU/MAU', async () => {
      await service.trackEvent(1, EventType.LOGIN, { source: 'mobile' });

      expect(redis.xadd).toHaveBeenCalledWith(
        'analytics:events',
        '*',
        expect.objectContaining({
          userId: '1',
          eventType: 'login',
        }),
      );
      expect(redis.pfadd).toHaveBeenCalledWith(
        expect.stringMatching(/dau:\d{4}-\d{2}-\d{2}/),
        '1',
      );
      expect(redis.pfadd).toHaveBeenCalledWith(
        expect.stringMatching(/mau:\d{4}-\d{2}/),
        '1',
      );
    });

    it('should handle purchase events and update LTV', async () => {
      ltvRepo.findOne = jest.fn().mockResolvedValue(null);
      ltvRepo.create = jest.fn().mockReturnValue({ userId: 1 });
      ltvRepo.save = jest.fn().mockResolvedValue({});

      await service.trackEvent(1, EventType.PURCHASE, { amount: '99.99', productId: 'coins_1000' });

      expect(redis.xadd).toHaveBeenCalled();
      expect(redis.hincrbyfloat).toHaveBeenCalledWith('ltv:1', 'value', 99.99);
    });

    it('should handle game end events and update stats', async () => {
      await service.trackEvent(1, EventType.GAME_END, { duration: '600', result: 'win' });

      expect(redis.hincrby).toHaveBeenCalledWith('user:1:games', 'count', 1);
    });
  });

  describe('flushEventsToDatabase', () => {
    it('should flush events from Redis Stream to DB', async () => {
      redis.xread = jest.fn().mockResolvedValue([
        ['analytics:events', [
          ['1-0', ['userId', '1', 'eventType', 'login', 'eventData', '{}', 'timestamp', Date.now().toString()]],
          ['2-0', ['userId', '2', 'eventType', 'game_start', 'eventData', '{"gameType":"chess"}', 'timestamp', Date.now().toString()]],
        ]],
      ]);

      const queryBuilder = eventRepo.createQueryBuilder();
      queryBuilder.execute = jest.fn().mockResolvedValue({});

      const count = await service.flushEventsToDatabase();

      expect(count).toBe(2);
      expect(queryBuilder.insert).toHaveBeenCalled();
      expect(queryBuilder.into).toHaveBeenCalledWith(AnalyticsEvent);
    });

    it('should return 0 when no events in stream', async () => {
      redis.xread = jest.fn().mockResolvedValue(null);

      const count = await service.flushEventsToDatabase();

      expect(count).toBe(0);
    });
  });

  describe('getActiveUsers', () => {
    it('should return DAU from Redis HyperLogLog', async () => {
      redis.pfcount = jest.fn().mockResolvedValue(1500);

      const dau = await service.getActiveUsers(new Date(), 'daily');

      expect(dau).toBe(1500);
      expect(redis.pfcount).toHaveBeenCalled();
    });

    it('should fallback to DB when Redis is empty', async () => {
      redis.pfcount = jest.fn().mockResolvedValue(0);
      const queryBuilder = eventRepo.createQueryBuilder();
      queryBuilder.getRawOne = jest.fn().mockResolvedValue({ count: '2000' });

      const dau = await service.getActiveUsers(new Date(), 'daily');

      expect(dau).toBe(2000);
    });

    it('should return MAU', async () => {
      redis.pfcount = jest.fn().mockResolvedValue(15000);

      const mau = await service.getActiveUsers(new Date(), 'monthly');

      expect(mau).toBe(15000);
    });
  });

  describe('getRetentionStats', () => {
    it('should return pre-computed cohort data', async () => {
      const mockCohorts = [
        {
          cohortDate: new Date('2024-01-15'),
          day0Rate: 100,
          day1Rate: 45.5,
          day3Rate: 38.2,
          day7Rate: 30.1,
          day14Rate: 25.0,
          day30Rate: 18.5,
        },
        {
          cohortDate: new Date('2024-01-14'),
          day0Rate: 100,
          day1Rate: 42.0,
          day3Rate: 35.5,
          day7Rate: 28.3,
          day14Rate: 22.1,
          day30Rate: 16.8,
        },
      ];

      cohortRepo.find = jest.fn().mockResolvedValue(mockCohorts);

      const result = await service.getRetentionStats(
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        'daily',
      );

      expect(result).toHaveLength(2);
      expect(result[0].day1).toBe(45.5);
      expect(result[0].day7).toBe(30.1);
      expect(result[0].day30).toBe(18.5);
    });

    it('should compute retention in real-time when no pre-computed data', async () => {
      cohortRepo.find = jest.fn().mockResolvedValue([]);

      // Mock new users
      const mockUsers = [
        { userId: 1, createdAt: new Date('2024-01-15') },
        { userId: 2, createdAt: new Date('2024-01-15') },
        { userId: 3, createdAt: new Date('2024-01-15') },
      ];

      const queryBuilder = eventRepo.createQueryBuilder();
      queryBuilder.getMany = jest.fn().mockResolvedValue(mockUsers);

      // Mock active user counts for each day
      queryBuilder.getRawOne = jest.fn()
        .mockResolvedValueOnce({ count: '3' })   // day0
        .mockResolvedValueOnce({ count: '2' })   // day1
        .mockResolvedValueOnce({ count: '1' })   // day3
        .mockResolvedValueOnce({ count: '1' })   // day7
        .mockResolvedValueOnce({ count: '0' })   // day14
        .mockResolvedValueOnce({ count: '0' });  // day30

      const result = await service.getRetentionStats(
        new Date('2024-01-15'),
        new Date('2024-01-15'),
        'daily',
      );

      expect(result).toHaveLength(1);
      expect(result[0].day0).toBe(100);
      expect(result[0].day1).toBeCloseTo(66.67, 1);
      expect(result[0].day3).toBeCloseTo(33.33, 1);
    });
  });

  describe('computeRetentionCohorts', () => {
    it('should compute and save cohort data', async () => {
      const queryBuilder = eventRepo.createQueryBuilder();
      queryBuilder.getRawMany = jest.fn()
        .mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }, { userId: 3 }]); // new users

      queryBuilder.getRawOne = jest.fn()
        .mockResolvedValueOnce({ count: '3' })   // day0
        .mockResolvedValueOnce({ count: '2' })   // day1
        .mockResolvedValueOnce({ count: '1' })   // day3
        .mockResolvedValueOnce({ count: '1' })   // day7
        .mockResolvedValueOnce({ count: '0' })   // day14
        .mockResolvedValueOnce({ count: '0' });  // day30

      cohortRepo.findOne = jest.fn().mockResolvedValue(null);
      cohortRepo.create = jest.fn().mockReturnValue({});
      cohortRepo.save = jest.fn().mockResolvedValue({});

      await service.computeRetentionCohorts(new Date('2024-01-15'));

      expect(cohortRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          totalUsers: 3,
          day0Active: 3,
          day1Active: 2,
          day3Active: 1,
          day7Active: 1,
          day14Active: 0,
          day30Active: 0,
        }),
      );
    });

    it('should update existing cohort record', async () => {
      const existingCohort = {
        id: 1,
        cohortDate: new Date('2024-01-15'),
        cohortType: CohortType.DAILY,
        totalUsers: 3,
        day0Active: 3,
        day0Rate: 100,
        day1Active: 0,
        day1Rate: 0,
      };

      const queryBuilder = eventRepo.createQueryBuilder();
      queryBuilder.getRawMany = jest.fn()
        .mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }, { userId: 3 }]);

      queryBuilder.getRawOne = jest.fn()
        .mockResolvedValueOnce({ count: '3' })
        .mockResolvedValueOnce({ count: '2' })
        .mockResolvedValueOnce({ count: '1' })
        .mockResolvedValueOnce({ count: '1' })
        .mockResolvedValueOnce({ count: '0' })
        .mockResolvedValueOnce({ count: '0' });

      cohortRepo.findOne = jest.fn().mockResolvedValue(existingCohort);
      cohortRepo.save = jest.fn().mockImplementation((c) => c);

      await service.computeRetentionCohorts(new Date('2024-01-15'));

      expect(cohortRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          day1Active: 2,
        }),
      );
    });
  });

  describe('getUserLTV', () => {
    it('should return cached LTV value', async () => {
      redis.hget = jest.fn().mockResolvedValue('500.50');

      const ltv = await service.getUserLTV(1);

      expect(ltv).toBe(500.50);
    });

    it('should return LTV from database when cache miss', async () => {
      redis.hget = jest.fn().mockResolvedValue(null);
      ltvRepo.findOne = jest.fn().mockResolvedValue({
        userId: 1,
        totalSpent: 999.99,
        purchaseCount: 10,
      });

      const ltv = await service.getUserLTV(1);

      expect(ltv).toBe(999.99);
      expect(redis.hset).toHaveBeenCalledWith('ltv:1', expect.any(Object));
    });

    it('should calculate LTV in real-time when no record exists', async () => {
      redis.hget = jest.fn().mockResolvedValue(null);
      ltvRepo.findOne = jest.fn().mockResolvedValue(null);

      const queryBuilder = eventRepo.createQueryBuilder();
      queryBuilder.getRawOne = jest.fn().mockResolvedValue({ total: '250.00' });

      const ltv = await service.getUserLTV(1);

      expect(ltv).toBe(250.00);
    });
  });

  describe('updateUserLTV', () => {
    it('should create new LTV record for first purchase', async () => {
      ltvRepo.findOne = jest.fn().mockResolvedValue(null);
      ltvRepo.create = jest.fn().mockReturnValue({ userId: 1 });
      ltvRepo.save = jest.fn().mockImplementation((ltv) => ltv);

      await (service as any).updateUserLTV(1, 99.99);

      expect(ltvRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 1,
        totalSpent: 0,
        purchaseCount: 0,
      }));
      expect(ltvRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          totalSpent: 99.99,
          purchaseCount: 1,
          avgPurchaseValue: 99.99,
        }),
      );
    });

    it('should update existing LTV record', async () => {
      const existing = {
        userId: 1,
        totalSpent: 200,
        purchaseCount: 2,
        avgPurchaseValue: 100,
        firstPurchaseAt: new Date('2024-01-01'),
      };

      ltvRepo.findOne = jest.fn().mockResolvedValue(existing);
      ltvRepo.save = jest.fn().mockImplementation((ltv) => ltv);

      await (service as any).updateUserLTV(1, 150);

      expect(ltvRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          totalSpent: 350,
          purchaseCount: 3,
          avgPurchaseValue: 116.67,
        }),
      );
    });
  });

  describe('getGameHeatmap', () => {
    it('should return hourly game activity stats', async () => {
      const queryBuilder = eventRepo.createQueryBuilder();
      queryBuilder.getRawMany = jest.fn()
        .mockResolvedValueOnce([
          { hour: 8, count: 50 },
          { hour: 12, count: 120 },
          { hour: 20, count: 200 },
        ])
        .mockResolvedValueOnce([
          { hour: 8, avgDuration: 600 },
          { hour: 12, avgDuration: 900 },
          { hour: 20, avgDuration: 1200 },
        ]);

      const result = await service.getGameHeatmap('chess', new Date('2024-01-15'));

      expect(result).toHaveLength(24);
      expect(result[8].count).toBe(50);
      expect(result[12].count).toBe(120);
      expect(result[20].count).toBe(200);
      expect(result[8].avgDuration).toBe(600);
      expect(result[0].count).toBe(0); // No data for hour 0
    });
  });

  describe('getConversionRate', () => {
    it('should return conversion funnel stats', async () => {
      const queryBuilder = eventRepo.createQueryBuilder();
      queryBuilder.getRawOne = jest.fn()
        .mockResolvedValueOnce({ count: '10000' })  // visitors
        .mockResolvedValueOnce({ count: '5000' })   // registered
        .mockResolvedValueOnce({ count: '500' })    // first purchase
        .mockResolvedValueOnce({ count: '150' });   // repeat purchase users (handled differently)

      queryBuilder.getRawMany = jest.fn()
        .mockResolvedValueOnce([
          { userId: 1, purchaseCount: 3 },
          { userId: 2, purchaseCount: 2 },
          { userId: 3, purchaseCount: 5 },
        ]);

      const result = await service.getConversionRate(
        new Date('2024-01-01'),
        new Date('2024-01-31'),
      );

      expect(result.totalVisitors).toBe(10000);
      expect(result.registeredUsers).toBe(5000);
      expect(result.firstPurchaseUsers).toBe(500);
      expect(result.registrationRate).toBe(50);
      expect(result.firstPurchaseRate).toBe(10);
      expect(result.overallConversionRate).toBe(5);
    });
  });

  describe('getFunnelAnalysis', () => {
    it('should return funnel data with conversion rates', async () => {
      const queryBuilder = eventRepo.createQueryBuilder();
      queryBuilder.getRawOne = jest.fn()
        .mockResolvedValueOnce({ count: '10000' })  // register
        .mockResolvedValueOnce({ count: '8000' })   // tutorial
        .mockResolvedValueOnce({ count: '6000' })   // game_start
        .mockResolvedValueOnce({ count: '3000' })   // purchase
        .mockResolvedValueOnce({ count: '1500' });  // share

      const result = await service.getFunnelAnalysis(
        ['register', 'tutorial', 'game_start', 'purchase', 'share'],
        { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
      );

      expect(result.steps).toHaveLength(5);
      expect(result.stepData[0].count).toBe(10000);
      expect(result.stepData[0].conversionRate).toBe(100); // First step
      expect(result.stepData[1].count).toBe(8000);
      expect(result.stepData[1].conversionRate).toBe(80); // 8000/10000
      expect(result.stepData[2].count).toBe(6000);
      expect(result.stepData[2].conversionRate).toBe(75); // 6000/8000
      expect(result.stepData[3].count).toBe(3000);
      expect(result.stepData[3].conversionRate).toBe(50); // 3000/6000
      expect(result.stepData[4].count).toBe(1500);
      expect(result.stepData[4].conversionRate).toBe(50); // 1500/3000
    });
  });

  describe('getDashboardStats', () => {
    it('should return complete dashboard statistics', async () => {
      const queryBuilder = eventRepo.createQueryBuilder();

      // Mock all the parallel queries
      queryBuilder.getRawOne = jest.fn()
        .mockResolvedValueOnce({ count: '1500' })    // DAU
        .mockResolvedValueOnce({ count: '3' })        // new users
        .mockResolvedValueOnce({ count: '5000' })     // games played
        .mockResolvedValueOnce({ total: '999.99' })   // revenue
        .mockResolvedValueOnce({ count: '50000' })    // total users
        .mockResolvedValueOnce({ count: '800' })      // DAU fallback
        .mockResolvedValueOnce({ count: '20000' });   // MAU

      cohortRepo.findOne = jest.fn().mockResolvedValue({
        day1Rate: 45.5,
        day7Rate: 30.2,
      });

      queryBuilder.getRawMany = jest.fn()
        .mockResolvedValueOnce([])  // repeat purchase
        .mockResolvedValueOnce([{ gameType: 'chess', count: 200 }]);

      const result = await service.getDashboardStats();

      expect(result).toBeDefined();
      expect(result.dau).toBe(1500);
      expect(result.newUsersToday).toBe(3);
      expect(result.gamesPlayedToday).toBe(5000);
      expect(result.revenueToday).toBe(999.99);
      expect(result.totalUsers).toBe(50000);
      expect(result.retentionD1).toBe(45.5);
      expect(result.retentionD7).toBe(30.2);
      expect(result.topGame).toBe('chess');
      expect(result.arpu).toBeGreaterThan(0);
    });
  });

  describe('computeDailyStats', () => {
    it('should compute and save daily statistics', async () => {
      const queryBuilder = eventRepo.createQueryBuilder();

      queryBuilder.getRawOne = jest.fn()
        .mockResolvedValueOnce({ count: '1500' })    // DAU
        .mockResolvedValueOnce({ count: '50' })       // new users
        .mockResolvedValueOnce({ count: '3000' })     // games played
        .mockResolvedValueOnce({ total: '5000.00' })  // revenue
        .mockResolvedValueOnce({ avg: '900.50' })     // avg session
        .mockResolvedValueOnce({ count: '100' });     // paid users

      queryBuilder.getRawMany = jest.fn()
        .mockResolvedValueOnce([{ gameType: 'chess', count: 1500 }, { gameType: 'blitz', count: 1000 }])
        .mockResolvedValueOnce([]);

      dailyStatsRepo.findOne = jest.fn().mockResolvedValue(null);
      dailyStatsRepo.create = jest.fn().mockReturnValue({});
      dailyStatsRepo.save = jest.fn().mockImplementation((s) => s);

      await service.computeDailyStats(new Date('2024-01-15'));

      expect(dailyStatsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          dau: 1500,
          newUsers: 50,
          gamesPlayed: 3000,
          revenue: 5000,
          avgSessionDuration: 900.50,
          paidUsers: 100,
          topGame: 'chess',
        }),
      );
    });
  });

  describe('handleSpecialEvents', () => {
    it('should update LTV on purchase', async () => {
      ltvRepo.findOne = jest.fn().mockResolvedValue(null);
      ltvRepo.create = jest.fn().mockReturnValue({ userId: 1 });
      ltvRepo.save = jest.fn().mockResolvedValue({});

      await service.trackEvent(1, EventType.PURCHASE, { amount: '50.00' });

      expect(redis.hincrbyfloat).toHaveBeenCalledWith('ltv:1', 'value', 50.0);
    });

    it('should update game stats on game_end', async () => {
      await service.trackEvent(1, EventType.GAME_END, { duration: '1200' });

      expect(redis.hincrby).toHaveBeenCalledWith('user:1:games', 'count', 1);
      expect(redis.hincrby).toHaveBeenCalledWith('user:1:games', 'totalMinutes', 20);
    });

    it('should update invite count on invite', async () => {
      await service.trackEvent(1, EventType.INVITE, { inviteeId: 2 });

      expect(redis.hincrby).toHaveBeenCalledWith('user:1:invites', 'count', 1);
    });
  });
});
