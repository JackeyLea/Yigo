import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GiftpackService, GiftPack, PurchaseResult } from './giftpack.service';
import { UserBalance } from '../common/entities';
import { REDIS_KEYS } from '../common/constants';

describe('GiftpackService', () => {
  let service: GiftpackService;
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
    publish: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GiftpackService,
        { provide: getRepositoryToken(UserBalance), useValue: mockBalanceRepo },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<GiftpackService>(GiftpackService);
    balanceRepo = module.get(getRepositoryToken(UserBalance));
    redis = mockRedis;

    jest.clearAllMocks();
  });

  describe('getAvailablePacks', () => {
    it('should return all packs for new user', async () => {
      mockRedis.get.mockResolvedValue(null);

      const packs = await service.getAvailablePacks(1);

      expect(packs.length).toBeGreaterThan(0);
      expect(packs.some(p => p.id === 'newbie_pack')).toBe(true);
      expect(packs.some(p => p.id === 'daily_pack')).toBe(true);
    });

    it('should not include daily pack if already claimed', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.GIFTPACK_DAILY_CLAIMED(1, 'daily_pack')) return '1';
        return null;
      });

      const packs = await service.getAvailablePacks(1);

      expect(packs.some(p => p.id === 'daily_pack')).toBe(false);
    });

    it('should not include newbie pack if already claimed', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.GIFTPACK_PURCHASED(1, 'newbie_pack')) return '1';
        return null;
      });

      const packs = await service.getAvailablePacks(1);

      expect(packs.some(p => p.id === 'newbie_pack')).toBe(false);
    });
  });

  describe('purchasePack', () => {
    it('should purchase daily pack successfully', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 10000 } as UserBalance);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.publish.mockResolvedValue(1);
      mockBalanceRepo.increment.mockResolvedValue({} as any);
      mockBalanceRepo.decrement.mockResolvedValue({} as any);

      const result = await service.purchasePack(1, 'daily_pack');

      expect(result.packId).toBe('daily_pack');
      expect(result.price).toBe(600);
      expect(result.isFree).toBe(false);
      expect(mockBalanceRepo.decrement).toHaveBeenCalledWith({ userId: 1 }, 'coins', 600);
    });

    it('should throw error when pack not found', async () => {
      await expect(service.purchasePack(1, 'nonexistent')).rejects.toThrow('礼包不存在');
    });

    it('should throw error when insufficient balance', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 100 } as UserBalance);
      mockRedis.get.mockResolvedValue(null);

      await expect(service.purchasePack(1, 'daily_pack')).rejects.toThrow('余额不足');
    });

    it('should throw error when purchase limit reached', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 10000 } as UserBalance);
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.GIFTPACK_PURCHASED(1, 'newbie_pack')) return '1';
        return null;
      });

      await expect(service.purchasePack(1, 'newbie_pack')).rejects.toThrow('已达到购买次数上限');
    });
  });

  describe('claimFreePack', () => {
    it('should claim free newbie pack', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 1000 } as UserBalance);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.publish.mockResolvedValue(1);
      mockBalanceRepo.increment.mockResolvedValue({} as any);

      const result = await service.claimFreePack(1, 'newbie_pack');

      expect(result.packId).toBe('newbie_pack');
      expect(result.isFree).toBe(true);
      expect(result.price).toBe(0);
      expect(mockBalanceRepo.decrement).not.toHaveBeenCalled();
    });

    it('should throw error for non-free pack', async () => {
      await expect(service.claimFreePack(1, 'daily_pack')).rejects.toThrow('该礼包不是免费礼包');
    });

    it('should throw error when already claimed', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.GIFTPACK_PURCHASED(1, 'newbie_pack')) return '1';
        return null;
      });

      await expect(service.claimFreePack(1, 'newbie_pack')).rejects.toThrow('暂不可购买');
    });
  });

  describe('checkPurchaseable', () => {
    it('should return true for available pack', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.checkPurchaseable(1, 'daily_pack');

      expect(result).toBe(true);
    });

    it('should return false for already claimed daily pack', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === REDIS_KEYS.GIFTPACK_DAILY_CLAIMED(1, 'daily_pack')) return '1';
        return null;
      });

      const result = await service.checkPurchaseable(1, 'daily_pack');

      expect(result).toBe(false);
    });

    it('should return false for non-existent pack', async () => {
      const result = await service.checkPurchaseable(1, 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('pack contents grant', () => {
    it('should grant coins and publish events for items', async () => {
      mockBalanceRepo.findOne.mockResolvedValue({ userId: 1, coins: 1000 } as UserBalance);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.publish.mockResolvedValue(1);
      mockBalanceRepo.increment.mockResolvedValue({} as any);

      const result = await service.claimFreePack(1, 'newbie_pack');

      // 新手礼包包含金币、VIP天数、建房卡
      expect(result.contents).toHaveLength(3);
      expect(result.contents.some(c => c.type === 'coins')).toBe(true);
      expect(result.contents.some(c => c.type === 'vip_day')).toBe(true);
      expect(result.contents.some(c => c.type === 'item')).toBe(true);

      // 验证金币增加
      expect(mockBalanceRepo.increment).toHaveBeenCalledWith(
        { userId: 1 },
        'coins',
        1000,
      );

      // 验证VIP天数事件
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'economy:vip:grant',
        JSON.stringify({ userId: 1, days: 1 }),
      );
    });
  });
});
