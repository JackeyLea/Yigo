import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankruptcyService } from './bankruptcy.service';
import { UserBalance } from '../common/entities';
import { BANKRUPTCY, REDIS_KEYS } from '../common/constants';

describe('BankruptcyService', () => {
  let service: BankruptcyService;
  let balanceRepo: jest.Mocked<Repository<UserBalance>>;
  let redis: any;

  const mockBalanceRepo = {
    findOne: jest.fn(),
    increment: jest.fn(),
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankruptcyService,
        { provide: getRepositoryToken(UserBalance), useValue: mockBalanceRepo },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<BankruptcyService>(BankruptcyService);
    balanceRepo = module.get(getRepositoryToken(UserBalance));
    redis = mockRedis;

    jest.clearAllMocks();
  });

  describe('canClaimRelief', () => {
    it('should deny claim when balance is above threshold', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 500 } as UserBalance);
      mockRedis.get.mockResolvedValue(null);

      const result = await service.canClaimRelief(1);

      expect(result.canClaim).toBe(false);
      expect(result.reason).toContain('未达到破产条件');
    });

    it('should deny claim when daily limit reached', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 50 } as UserBalance);
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.BANKRUPTCY_CLAIM_COUNT(1)) return '3';
        return null;
      });

      const result = await service.canClaimRelief(1);

      expect(result.canClaim).toBe(false);
      expect(result.reason).toContain('已达上限');
    });

    it('should deny claim during cooldown', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 50 } as UserBalance);
      const now = Date.now();
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.BANKRUPTCY_CLAIM_COUNT(1)) return '1';
        if (key === REDIS_KEYS.BANKRUPTCY_LAST_CLAIM(1)) return now.toString();
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        return null;
      });

      const result = await service.canClaimRelief(1);

      expect(result.canClaim).toBe(false);
      expect(result.reason).toContain('领取过于频繁');
    });

    it('should allow claim when all conditions met', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 50 } as UserBalance);
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.BANKRUPTCY_CLAIM_COUNT(1)) return '0';
        if (key === REDIS_KEYS.BANKRUPTCY_LAST_CLAIM(1)) return null;
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        return null;
      });

      const result = await service.canClaimRelief(1);

      expect(result.canClaim).toBe(true);
      expect(result.claimCount).toBe(0);
    });
  });

  describe('claimRelief', () => {
    it('should successfully claim relief', async () => {
      mockBalanceRepo.findOne
        .mockResolvedValueOnce({ userId: 1, coins: 50 } as UserBalance)
        .mockResolvedValueOnce({ userId: 1, coins: 550 } as UserBalance);
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.BANKRUPTCY_CLAIM_COUNT(1)) return '0';
        if (key === REDIS_KEYS.BANKRUPTCY_LAST_CLAIM(1)) return null;
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        return null;
      });
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.ttl.mockResolvedValue(-1);
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.set.mockResolvedValue('OK');
      mockBalanceRepo.increment.mockResolvedValue({} as any);

      const result = await service.claimRelief(1);

      expect(result.amount).toBe(BANKRUPTCY.RELIEF_AMOUNT);
      expect(result.totalClaims).toBe(1);
      expect(result.remainingClaims).toBe(BANKRUPTCY.MAX_DAILY_CLAIMS - 1);
      expect(mockBalanceRepo.increment).toHaveBeenCalledWith({ userId: 1 }, 'coins', BANKRUPTCY.RELIEF_AMOUNT);
    });

    it('should throw error when balance is sufficient', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 500 } as UserBalance);
      mockRedis.get.mockResolvedValue(null);

      await expect(service.claimRelief(1)).rejects.toThrow('未达到破产条件');
    });
  });

  describe('getTodayClaimCount', () => {
    it('should return 0 when no claims made', async () => {
      mockRedis.get.mockResolvedValue(null);

      const count = await service.getTodayClaimCount(1);

      expect(count).toBe(0);
    });

    it('should return correct claim count', async () => {
      mockRedis.get.mockResolvedValue('2');

      const count = await service.getTodayClaimCount(1);

      expect(count).toBe(2);
    });
  });

  describe('getMaxDailyClaims', () => {
    it('should return base claims for non-VIP user', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return null;
        return null;
      });

      const max = await service.getMaxDailyClaims(1);

      expect(max).toBe(BANKRUPTCY.MAX_DAILY_CLAIMS);
    });

    it('should return extra claims for VIP2+ user', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.VIP_LEVEL(1)) return '2';
        return null;
      });

      const max = await service.getMaxDailyClaims(1);

      expect(max).toBe(BANKRUPTCY.MAX_DAILY_CLAIMS + 1);
    });
  });
});
