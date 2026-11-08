import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VipService, VipLevel, VipPrivilege } from './vip.service';
import { UserBalance } from '../common/entities';
import { VIP, REDIS_KEYS } from '../common/constants';

describe('VipService', () => {
  let service: VipService;
  let balanceRepo: jest.Mocked<Repository<UserBalance>>;
  let redis: any;

  const mockBalanceRepo = {
    findOne: jest.fn(),
    increment: jest.fn(),
    decrement: jest.fn(),
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    publish: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VipService,
        { provide: getRepositoryToken(UserBalance), useValue: mockBalanceRepo },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<VipService>(VipService);
    balanceRepo = module.get(getRepositoryToken(UserBalance));
    redis = mockRedis;

    jest.clearAllMocks();
  });

  describe('getVipLevel', () => {
    it('should return level 0 for non-VIP user', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getVipLevel(1);

      expect(result.level).toBe(0);
      expect(result.name).toBe('普通');
      expect(result.privileges).toHaveLength(0);
    });

    it('should return VIP level with privileges', async () => {
      const future = Date.now() + 86400000;
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return '3';
        if (key === REDIS_KEYS.VIP_EXPIRE(1)) return future.toString();
        return null;
      });

      const result = await service.getVipLevel(1);

      expect(result.level).toBe(3);
      expect(result.name).toBe('黄金');
      expect(result.privileges.length).toBeGreaterThan(0);
    });

    it('should expire VIP if past expiration', async () => {
      const past = Date.now() - 86400000;
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return '3';
        if (key === REDIS_KEYS.VIP_EXPIRE(1)) return past.toString();
        return null;
      });
      mockRedis.del.mockResolvedValue(1);

      const result = await service.getVipLevel(1);

      expect(result.level).toBe(0);
      expect(result.name).toBe('普通');
      expect(mockRedis.del).toHaveBeenCalledWith(REDIS_KEYS.VIP_LEVEL(1));
    });
  });

  describe('purchaseVip', () => {
    it('should purchase VIP successfully', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 100000 } as UserBalance);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.publish.mockResolvedValue(1);

      const result = await service.purchaseVip(1, 3);

      expect(result.level).toBe(3);
      expect(result.name).toBe('黄金');
      expect(result.price).toBe(VIP.LEVELS[3].price);
      expect(result.expireAt).toBeInstanceOf(Date);
    });

    it('should extend VIP if already active', async () => {
      const future = Date.now() + 86400000;
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 100000 } as UserBalance);
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.VIP_EXPIRE(1)) return future.toString();
        return null;
      });
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.publish.mockResolvedValue(1);

      const result = await service.purchaseVip(1, 3);

      expect(result.level).toBe(3);
      // 过期时间应该在30天之后的基础上延长
      const daysDiff = (result.expireAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThan(30);
    });

    it('should throw error for invalid level', async () => {
      await expect(service.purchaseVip(1, 7)).rejects.toThrow('VIP等级必须在1-6之间');
    });

    it('should throw error for insufficient balance', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 100 } as UserBalance);

      await expect(service.purchaseVip(1, 6)).rejects.toThrow('余额不足');
    });
  });

  describe('checkPrivilege', () => {
    it('should return false for non-VIP user', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.checkPrivilege(1, 'signin_2x');

      expect(result).toBe(false);
    });

    it('should return true for owned privilege', async () => {
      const future = Date.now() + 86400000;
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return '3';
        if (key === REDIS_KEYS.VIP_EXPIRE(1)) return future.toString();
        return null;
      });

      const result = await service.checkPrivilege(1, 'signin_2x');

      expect(result).toBe(true);
    });

    it('should return false for non-owned privilege', async () => {
      const future = Date.now() + 86400000;
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return '1';
        if (key === REDIS_KEYS.VIP_EXPIRE(1)) return future.toString();
        return null;
      });

      const result = await service.checkPrivilege(1, 'free_spin_2x');

      expect(result).toBe(false);
    });

    it('should return true for supreme member on any privilege', async () => {
      const future = Date.now() + 86400000;
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return '6';
        if (key === REDIS_KEYS.VIP_EXPIRE(1)) return future.toString();
        return null;
      });

      const result = await service.checkPrivilege(1, 'any_privilege');

      expect(result).toBe(true);
    });
  });

  describe('getVipPrivileges', () => {
    it('should return all privilege definitions', () => {
      const privileges = service.getVipPrivileges();

      expect(privileges.length).toBeGreaterThan(0);
      expect(privileges[0]).toHaveProperty('id');
      expect(privileges[0]).toHaveProperty('name');
      expect(privileges[0]).toHaveProperty('description');
      expect(privileges[0]).toHaveProperty('levels');
    });
  });
});
