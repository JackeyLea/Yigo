import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getRedisToken } from '@liaoliaots/nestjs-redis';
import { PushService, PushFilter } from './push.service';
import { DeviceToken, Platform, PushLog, PushStatus, PushType } from './entities';

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

const createMockRepository = <T>(): MockRepository<T> => {
  // 共享同一个 queryBuilder 实例：测试中捕获的实例与被测服务内部拿到的是同一个对象
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getManyAndCount: jest.fn(),
  };
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder),
    update: jest.fn(),
  };
};

describe('PushService', () => {
  let service: PushService;
  let deviceTokenRepo: MockRepository<DeviceToken>;
  let pushLogRepo: MockRepository<PushLog>;
  let redis: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: getRepositoryToken(DeviceToken), useValue: createMockRepository<DeviceToken>() },
        { provide: getRepositoryToken(PushLog), useValue: createMockRepository<PushLog>() },
        {
          provide: getRedisToken('default'),
          useValue: {
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
            lpush: jest.fn().mockResolvedValue(1),
            rpoplpush: jest.fn().mockResolvedValue(null),
            lrem: jest.fn().mockResolvedValue(1),
            incr: jest.fn().mockResolvedValue(1),
            decrby: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
            xadd: jest.fn().mockResolvedValue('1-0'),
            pipeline: jest.fn(() => ({
              lpush: jest.fn().mockReturnThis(),
              exec: jest.fn().mockResolvedValue([]),
            })),
          },
        },
      ],
    }).compile();

    service = module.get<PushService>(PushService);
    deviceTokenRepo = module.get(getRepositoryToken(DeviceToken));
    pushLogRepo = module.get(getRepositoryToken(PushLog));
    redis = module.get(getRedisToken('default'));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerDevice', () => {
    it('should create new device token', async () => {
      deviceTokenRepo.findOne = jest.fn().mockResolvedValue(null);
      deviceTokenRepo.create = jest.fn().mockReturnValue({ id: 1 });
      deviceTokenRepo.save = jest.fn().mockResolvedValue({ id: 1 });

      await service.registerDevice(1, {
        deviceToken: 'test-token-123',
        platform: Platform.IOS,
        deviceModel: 'iPhone 15',
        osVersion: '17.0',
      });

      expect(deviceTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          deviceToken: 'test-token-123',
          platform: Platform.IOS,
        }),
      );
      expect(deviceTokenRepo.save).toHaveBeenCalled();
      expect(redis.sadd).toHaveBeenCalledWith('user:1:devices', 'test-token-123');
    });

    it('should update existing device token', async () => {
      const existing = {
        id: 1,
        userId: 1,
        deviceToken: 'test-token-123',
        platform: Platform.IOS,
        isActive: false,
      };
      deviceTokenRepo.findOne = jest.fn().mockResolvedValue(existing);
      deviceTokenRepo.save = jest.fn().mockResolvedValue({ ...existing, isActive: true });

      await service.registerDevice(2, {
        deviceToken: 'test-token-123',
        platform: Platform.ANDROID,
      });

      expect(deviceTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 2,
          platform: Platform.ANDROID,
          isActive: true,
        }),
      );
    });
  });

  describe('unregisterDevice', () => {
    it('should deactivate device token', async () => {
      deviceTokenRepo.findOne = jest.fn().mockResolvedValue({
        id: 1,
        userId: 1,
        deviceToken: 'test-token',
      });
      deviceTokenRepo.save = jest.fn().mockResolvedValue({});

      await service.unregisterDevice(1, 'test-token');

      expect(deviceTokenRepo.save).toHaveBeenCalled();
      expect(redis.srem).toHaveBeenCalledWith('user:1:devices', 'test-token');
    });

    it('should handle non-existent device', async () => {
      deviceTokenRepo.findOne = jest.fn().mockResolvedValue(null);

      await service.unregisterDevice(1, 'non-existent');

      expect(redis.srem).toHaveBeenCalled();
    });
  });

  describe('sendToUser', () => {
    it('should queue push for all user devices', async () => {
      deviceTokenRepo.find = jest.fn().mockResolvedValue([
        { userId: 1, deviceToken: 'ios-token', platform: Platform.IOS },
        { userId: 1, deviceToken: 'android-token', platform: Platform.ANDROID },
      ]);
      redis.lpush = jest.fn().mockResolvedValue(1);

      // Override processPushQueue to avoid actual network calls
      jest.spyOn(service as any, 'processPushQueue').mockResolvedValue(undefined);

      await service.sendToUser(1, 'Test Title', 'Test Body', { roomId: '123' });

      expect(redis.lpush).toHaveBeenCalledTimes(2);
      expect(redis.lpush).toHaveBeenCalledWith(
        'push:queue',
        expect.stringContaining('Test Title'),
      );
    });

    it('should warn when no devices found', async () => {
      deviceTokenRepo.find = jest.fn().mockResolvedValue([]);
      const loggerSpy = jest.spyOn((service as any).logger, 'warn');

      await service.sendToUser(1, 'Test', 'Body');

      expect(loggerSpy).toHaveBeenCalledWith('No active devices for user 1');
    });
  });

  describe('broadcast', () => {
    it('should queue broadcast for all matching devices', async () => {
      const mockDevices = Array.from({ length: 5 }, (_, i) => ({
        userId: i + 1,
        deviceToken: `token-${i}`,
        platform: Platform.IOS,
      }));

      const queryBuilder = deviceTokenRepo.createQueryBuilder();
      queryBuilder.getMany = jest.fn().mockResolvedValue(mockDevices);

      jest.spyOn(service as any, 'processPushQueue').mockResolvedValue(undefined);

      await service.broadcast('Broadcast Title', 'Broadcast Body', {
        platforms: [Platform.IOS],
      });

      expect(deviceTokenRepo.createQueryBuilder).toHaveBeenCalled();
      expect(redis.pipeline).toHaveBeenCalled();
    });

    it('should apply platform filter', async () => {
      const queryBuilder = deviceTokenRepo.createQueryBuilder();
      queryBuilder.getMany = jest.fn().mockResolvedValue([]);

      jest.spyOn(service as any, 'processPushQueue').mockResolvedValue(undefined);

      await service.broadcast('Title', 'Body', {
        platforms: ['ios', 'android'],
        minLevel: 10,
        vipOnly: true,
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'device.platform IN (:...platforms)',
        { platforms: ['ios', 'android'] },
      );
    });
  });

  describe('sendRoomInvite', () => {
    it('should send room invite push', async () => {
      redis.hget = jest.fn().mockResolvedValue('InviterName');
      deviceTokenRepo.find = jest.fn().mockResolvedValue([
        { userId: 2, deviceToken: 'token-1', platform: Platform.IOS },
      ]);
      redis.lpush = jest.fn().mockResolvedValue(1);
      pushLogRepo.create = jest.fn().mockReturnValue({ id: 1 });
      pushLogRepo.save = jest.fn().mockResolvedValue({ id: 1 });

      jest.spyOn(service as any, 'processPushQueue').mockResolvedValue(undefined);

      await service.sendRoomInvite(1, 2, 'room-123');

      expect(redis.lpush).toHaveBeenCalledWith(
        'push:queue',
        expect.stringContaining('InviterName'),
      );
      expect(pushLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PushType.ROOM_INVITE,
          userId: 2,
        }),
      );
    });
  });

  describe('sendGameStartReminder', () => {
    it('should send game reminder push', async () => {
      deviceTokenRepo.find = jest.fn().mockResolvedValue([
        { userId: 1, deviceToken: 'token-1', platform: Platform.IOS },
      ]);
      redis.lpush = jest.fn().mockResolvedValue(1);
      pushLogRepo.create = jest.fn().mockReturnValue({ id: 1 });
      pushLogRepo.save = jest.fn().mockResolvedValue({ id: 1 });

      jest.spyOn(service as any, 'processPushQueue').mockResolvedValue(undefined);

      await service.sendGameStartReminder(1, 'room-456');

      expect(redis.lpush).toHaveBeenCalledWith(
        'push:queue',
        expect.stringContaining('Game Starting Soon'),
      );
    });
  });

  describe('sendActivityNotification', () => {
    it('should send activity notification to all users', async () => {
      const queryBuilder = deviceTokenRepo.createQueryBuilder();
      queryBuilder.getMany = jest.fn().mockResolvedValue([
        { userId: 1, deviceToken: 'token-1', platform: Platform.IOS },
        { userId: 2, deviceToken: 'token-2', platform: Platform.ANDROID },
      ]);

      jest.spyOn(service as any, 'processPushQueue').mockResolvedValue(undefined);

      await service.sendActivityNotification('activity-1', 'New Event', 'Check out the new event!');

      expect(pushLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PushType.ACTIVITY,
          title: 'New Event',
        }),
      );
    });
  });

  describe('processPushQueue', () => {
    it('should process jobs from queue', async () => {
      const mockJob = JSON.stringify({
        userId: 1,
        deviceToken: 'ios-token',
        platform: Platform.IOS,
        title: 'Test',
        body: 'Body',
        data: {},
        type: PushType.UNICAST,
        timestamp: Date.now(),
      });

      redis.rpoplpush = jest.fn()
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(null);

      redis.lrem = jest.fn().mockResolvedValue(1);

      const sendToProviderSpy = jest.spyOn(service as any, 'sendToProvider')
        .mockResolvedValue(undefined);

      await service.processPushQueue();

      expect(sendToProviderSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle failed jobs with retry', async () => {
      const mockJob = JSON.stringify({
        userId: 1,
        deviceToken: 'bad-token',
        platform: Platform.IOS,
        title: 'Test',
        body: 'Body',
        data: {},
        type: PushType.UNICAST,
        timestamp: Date.now(),
      });

      redis.rpoplpush = jest.fn()
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(null);

      redis.incr = jest.fn().mockResolvedValue(1); // fail count
      redis.lpush = jest.fn().mockResolvedValue(1);
      redis.lrem = jest.fn().mockResolvedValue(1);

      const sendToProviderSpy = jest.spyOn(service as any, 'sendToProvider')
        .mockRejectedValue(new Error('Network error'));

      await service.processPushQueue();

      // Failed job should be pushed back to queue
      expect(redis.lpush).toHaveBeenCalled();
    });

    it('should mark device as inactive after 3 failures', async () => {
      const mockJob = JSON.stringify({
        userId: 1,
        deviceToken: 'dead-token',
        platform: Platform.IOS,
        title: 'Test',
        body: 'Body',
        data: {},
        type: PushType.UNICAST,
        timestamp: Date.now(),
      });

      redis.rpoplpush = jest.fn()
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(null);

      redis.incr = jest.fn().mockResolvedValue(3); // 3rd failure
      redis.del = jest.fn().mockResolvedValue(1);
      redis.lrem = jest.fn().mockResolvedValue(1);
      deviceTokenRepo.update = jest.fn().mockResolvedValue({});

      const sendToProviderSpy = jest.spyOn(service as any, 'sendToProvider')
        .mockRejectedValue(new Error('Invalid token'));

      await service.processPushQueue();

      expect(deviceTokenRepo.update).toHaveBeenCalledWith(
        { deviceToken: 'dead-token' },
        { isActive: false },
      );
    });
  });

  describe('getPushStats', () => {
    it('should return push statistics', async () => {
      const mockLogs = [
        { id: 1, platform: 'ios', status: PushStatus.SENT },
        { id: 2, platform: 'android', status: PushStatus.SENT },
        { id: 3, platform: 'ios', status: PushStatus.FAILED },
        { id: 4, platform: 'web', status: PushStatus.PENDING },
      ];

      pushLogRepo.createQueryBuilder = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockLogs),
      }));

      const result = await service.getPushStats(
        new Date('2024-01-01'),
        new Date('2024-12-31'),
      );

      expect(result.total).toBe(4);
      expect(result.sent).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.byPlatform.ios).toBe(2);
      expect(result.byPlatform.android).toBe(1);
      expect(result.byPlatform.web).toBe(1);
    });
  });
});
