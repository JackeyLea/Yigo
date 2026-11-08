import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LotteryService } from './lottery.service';
import { UserBalance } from '../common/entities';
import { LOTTERY, REDIS_KEYS } from '../common/constants';

describe('LotteryService', () => {
  let service: LotteryService;
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
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    del: jest.fn(),
    publish: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotteryService,
        { provide: getRepositoryToken(UserBalance), useValue: mockBalanceRepo },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<LotteryService>(LotteryService);
    balanceRepo = module.get(getRepositoryToken(UserBalance));
    redis = mockRedis;

    jest.clearAllMocks();
  });

  describe('getWheelConfig', () => {
    it('should return wheel configuration', async () => {
      const config = await service.getWheelConfig();

      expect(config.slots).toHaveLength(8);
      expect(config.freeSpinsPerDay).toBe(LOTTERY.FREE_SPIN_DAILY);
      expect(config.coinCostPerSpin).toBe(LOTTERY.COIN_COST_PER_SPIN);
      expect(config.jackpotGuarantee).toBe(LOTTERY.JACKPOT_GUARANTEE);
    });
  });

  describe('getFreeSpins', () => {
    it('should return daily free spins for non-VIP user', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_FREE_SPIN(1)) return null;
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        return null;
      });

      const freeSpins = await service.getFreeSpins(1);

      expect(freeSpins).toBe(LOTTERY.FREE_SPIN_DAILY);
    });

    it('should return reduced free spins after usage', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_FREE_SPIN(1)) return '1';
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        return null;
      });

      const freeSpins = await service.getFreeSpins(1);

      expect(freeSpins).toBe(0);
    });

    it('should return extra free spins for VIP2+ user', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_FREE_SPIN(1)) return '0';
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return '2';
        return null;
      });

      const freeSpins = await service.getFreeSpins(1);

      expect(freeSpins).toBe(3); // 1 base + 2 VIP
    });
  });

  describe('spin', () => {
    it('should use free spin when available', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_FREE_SPIN(1)) return '0';
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        return null;
      });
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.ttl.mockResolvedValue(3600);
      mockRedis.publish.mockResolvedValue(1);
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 1000 } as UserBalance);
      mockBalanceRepo.increment.mockResolvedValue({} as any);

      const result = await service.spin(1);

      expect(result.isFreeSpin).toBe(true);
      expect(result.prize).toBeDefined();
      expect(mockBalanceRepo.decrement).not.toHaveBeenCalled();
    });

    it('should deduct coins when no free spins', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_FREE_SPIN(1)) return '1';
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        if (key === REDIS_KEYS.LOTTERY_TOTAL_SPINS(1)) return '0';
        if (key === REDIS_KEYS.LOTTERY_JACKPOT_COUNTER(1)) return '0';
        return null;
      });
      mockRedis.incr.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_TOTAL_SPINS(1)) return Promise.resolve(1);
        if (key === REDIS_KEYS.LOTTERY_JACKPOT_COUNTER(1)) return Promise.resolve(1);
        return Promise.resolve(1);
      });
      mockRedis.ttl.mockResolvedValue(3600);
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 1000 } as UserBalance);
      mockBalanceRepo.increment.mockResolvedValue({} as any);
      mockBalanceRepo.decrement.mockResolvedValue({} as any);

      const result = await service.spin(1);

      expect(result.isFreeSpin).toBe(false);
      expect(mockBalanceRepo.decrement).toHaveBeenCalled();
    });

    it('should throw error when insufficient coins', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_FREE_SPIN(1)) return '1';
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        return null;
      });
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 50 } as UserBalance);

      await expect(service.spin(1)).rejects.toThrow('金币不足');
    });
  });

  describe('spinWithCoins', () => {
    it('should deduct specified cost and spin', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 1000 } as UserBalance);
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_TOTAL_SPINS(1)) return '0';
        if (key === REDIS_KEYS.LOTTERY_JACKPOT_COUNTER(1)) return '0';
        return null;
      });
      mockRedis.incr.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_TOTAL_SPINS(1)) return Promise.resolve(1);
        if (key === REDIS_KEYS.LOTTERY_JACKPOT_COUNTER(1)) return Promise.resolve(1);
        return Promise.resolve(1);
      });
      mockRedis.ttl.mockResolvedValue(3600);
      mockBalanceRepo.increment.mockResolvedValue({} as any);
      mockBalanceRepo.decrement.mockResolvedValue({} as any);

      const result = await service.spinWithCoins(1, 100);

      expect(result.isFreeSpin).toBe(false);
      expect(mockBalanceRepo.decrement).toHaveBeenCalledWith({ userId: 1 }, 'coins', 100);
    });
  });

  describe('jackpot guarantee', () => {
    it('should guarantee jackpot after 100 spins without jackpot', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 10000 } as UserBalance);
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_FREE_SPIN(1)) return '1';
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        return null;
      });
      // 模拟第100次抽奖
      mockRedis.incr.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.LOTTERY_TOTAL_SPINS(1)) return Promise.resolve(100);
        if (key === REDIS_KEYS.LOTTERY_JACKPOT_COUNTER(1)) return Promise.resolve(100);
        return Promise.resolve(1);
      });
      mockRedis.del.mockResolvedValue(1);
      mockBalanceRepo.increment.mockResolvedValue({} as any);
      mockBalanceRepo.decrement.mockResolvedValue({} as any);

      const result = await service.spin(1);

      expect(result.isJackpot).toBe(true);
      expect(result.prize.value).toBe(LOTTERY.JACKPOT_AMOUNT);
      expect(mockRedis.del).toHaveBeenCalledWith(REDIS_KEYS.LOTTERY_JACKPOT_COUNTER(1));
    });
  });
});
