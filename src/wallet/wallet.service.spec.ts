import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { WalletService, Settlement } from './wallet.service';
import { Wallet } from '../common/entities/wallet.entity';
import {
  Transaction,
  TransactionType,
} from '../common/entities/transaction.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

jest.mock('ioredis', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      setnx: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    })),
  };
});

describe('WalletService', () => {
  let service: WalletService;
  let walletRepository: jest.Mocked<Partial<Repository<Wallet>>>;
  let transactionRepository: jest.Mocked<Partial<Repository<Transaction>>>;
  let dataSource: jest.Mocked<Partial<DataSource>>;

  const mockQueryBuilder = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const mockManager = {
    getRepository: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: mockManager,
  };

  const mockWallet: Wallet = {
    wallet_id: '1',
    user_id: '1',
    currency: 'POINT',
    balance: '1000.0000',
    frozen: '100.0000',
    total_deposited: '2000',
    total_withdrawn: '1000',
    updated_at: new Date(),
    user: null as any,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    walletRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockReturnValue(mockWallet),
      save: jest.fn().mockResolvedValue(mockWallet),
    };

    transactionRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn().mockReturnValue({
        tx_id: '1',
        user_id: '1',
        tx_type: TransactionType.TRANSFER_OUT,
        amount: '-100',
        currency: 'POINT',
        balance_after: '900',
        idempotency_key: 'test-key',
      } as Transaction),
      save: jest.fn().mockImplementation((tx) => Promise.resolve(tx)),
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: getRepositoryToken(Wallet),
          useValue: walletRepository,
        },
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionRepository,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  describe('getBalance', () => {
    it('should return single wallet when currency specified', async () => {
      walletRepository.findOne!.mockResolvedValue(mockWallet);

      const result = await service.getBalance(1, 'POINT');

      expect(Array.isArray(result)).toBe(false);
      expect((result as Wallet).balance).toBe('1000.0000');
    });

    it('should return all wallets when no currency specified', async () => {
      walletRepository.find!.mockResolvedValue([mockWallet]);

      const result = await service.getBalance(1);

      expect(Array.isArray(result)).toBe(true);
      expect((result as Wallet[]).length).toBe(1);
    });
  });

  describe('transfer', () => {
    it('should throw BadRequestException for self-transfer', async () => {
      await expect(
        service.transfer(1, 1, 'POINT', 100, 'test', 'key'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-positive amount', async () => {
      await expect(
        service.transfer(1, 2, 'POINT', 0, 'test', 'key'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should transfer funds successfully', async () => {
      mockQueryBuilder.getOne
        .mockResolvedValueOnce(mockWallet)
        .mockResolvedValueOnce({ ...mockWallet, user_id: '2', balance: '500' });

      mockManager.getRepository.mockImplementation((entity: any) => {
        if (entity === Wallet) {
          return {
            create: jest.fn().mockReturnValue(mockWallet),
            save: jest.fn().mockImplementation((w) => Promise.resolve(w)),
          };
        }
        if (entity === Transaction) {
          return transactionRepository;
        }
        return {};
      });

      const result = await service.transfer(1, 2, 'POINT', 100, 'test', 'key');

      expect(result).toBeDefined();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('freeze', () => {
    it('should freeze funds successfully', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(mockWallet);

      mockManager.getRepository.mockImplementation((entity: any) => {
        if (entity === Wallet) {
          return {
            create: jest.fn().mockReturnValue(mockWallet),
            save: jest.fn().mockImplementation((w) => Promise.resolve(w)),
          };
        }
        if (entity === Transaction) {
          return transactionRepository;
        }
        return {};
      });

      const result = await service.freeze(1, 'POINT', 100, 'game', 'key');

      expect(result.freezeId).toBeDefined();
      expect(result.frozenAmount).toBe(100);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for non-positive amount', async () => {
      await expect(
        service.freeze(1, 'POINT', 0, 'test', 'key'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('unfreeze', () => {
    it('should unfreeze funds successfully', async () => {
      const freezeTx: Transaction = {
        tx_id: 'freeze-1',
        user_id: '1',
        tx_type: TransactionType.FREEZE,
        amount: '-100',
        currency: 'POINT',
        balance_after: '900',
        reference_id: null,
        reference_type: 'freeze',
        idempotency_key: 'freeze-key',
        created_at: new Date(),
        user: null as any,
      };

      mockQueryBuilder.getOne
        .mockResolvedValueOnce(freezeTx)
        .mockResolvedValueOnce(mockWallet);

      mockManager.getRepository.mockImplementation((entity: any) => {
        if (entity === Wallet) {
          return {
            create: jest.fn().mockReturnValue(mockWallet),
            save: jest.fn().mockImplementation((w) => Promise.resolve(w)),
          };
        }
        if (entity === Transaction) {
          return transactionRepository;
        }
        return {};
      });

      const result = await service.unfreeze('freeze-1', 'key');

      expect(result).toBeDefined();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent freeze', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(service.unfreeze('nonexistent', 'key')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('settle', () => {
    it('should batch settle successfully', async () => {
      const settlements: Settlement[] = [
        { userId: 1, currency: 'POINT', amount: 100, reason: 'win' },
        { userId: 2, currency: 'POINT', amount: -50, reason: 'loss' },
      ];

      mockQueryBuilder.getOne.mockResolvedValue(mockWallet);

      mockManager.getRepository.mockImplementation((entity: any) => {
        if (entity === Wallet) {
          return {
            create: jest.fn().mockReturnValue(mockWallet),
            save: jest.fn().mockImplementation((w) => Promise.resolve(w)),
          };
        }
        if (entity === Transaction) {
          return transactionRepository;
        }
        return {};
      });

      const result = await service.settle(settlements, 'batch-key');

      expect(Array.isArray(result)).toBe(true);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should return empty array for empty settlements', async () => {
      const result = await service.settle([], 'key');

      expect(result).toEqual([]);
    });
  });

  describe('getHistory', () => {
    it('should return paginated transactions', async () => {
      const mockTxs: Transaction[] = [
        {
          tx_id: '1',
          user_id: '1',
          tx_type: TransactionType.TRANSFER_IN,
          amount: '100',
          currency: 'POINT',
          balance_after: '1000',
          reference_id: null,
          reference_type: null,
          idempotency_key: 'key',
          created_at: new Date(),
          user: null as any,
        },
      ];

      transactionRepository.findAndCount!.mockResolvedValue([mockTxs, 1]);

      const result = await service.getHistory(1, 'POINT', 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('getWallets', () => {
    it('should return all wallets for a user', async () => {
      walletRepository.find!.mockResolvedValue([mockWallet]);

      const result = await service.getWallets(1);

      expect(result).toHaveLength(1);
    });
  });
});
