import { Test, TestingModule } from '@nestjs/testing';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { Wallet } from '../common/entities/wallet.entity';
import { Transaction, TransactionType } from '../common/entities/transaction.entity';
import { CurrentUserData } from '../common/decorators/current-user.decorator';

describe('WalletController', () => {
  let controller: WalletController;

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

  const mockWalletService = {
    getBalance: jest.fn(),
    transfer: jest.fn(),
    freeze: jest.fn(),
    unfreeze: jest.fn(),
    settle: jest.fn(),
    getHistory: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WalletController],
      providers: [
        { provide: WalletService, useValue: mockWalletService },
      ],
    }).compile();

    controller = module.get<WalletController>(WalletController);
  });

  describe('getBalance', () => {
    it('should return balance for specific currency', async () => {
      mockWalletService.getBalance.mockResolvedValue(mockWallet);

      const result = await controller.getBalance(
        { userId: 1, username: 'test' },
        'POINT',
      );

      // 指定currency时service返回单个Wallet
      expect((result as Wallet).balance).toBe('1000.0000');
      expect(mockWalletService.getBalance).toHaveBeenCalledWith(1, 'POINT');
    });
  });

  describe('transfer', () => {
    it('should transfer funds', async () => {
      const mockTx: Partial<Transaction> = {
        tx_id: '1',
        user_id: '2',
        tx_type: TransactionType.TRANSFER_IN,
        amount: '100',
        currency: 'POINT',
      };
      mockWalletService.transfer.mockResolvedValue(mockTx);

      const result = await controller.transfer(
        { userId: 1, username: 'test' },
        {
          toUserId: 2,
          currency: 'POINT',
          amount: 100,
          reason: 'payment',
          idempotencyKey: 'key1',
        },
      );

      expect(result.amount).toBe('100');
      expect(mockWalletService.transfer).toHaveBeenCalledWith(
        1, 2, 'POINT', 100, 'payment', 'key1',
      );
    });
  });

  describe('freeze', () => {
    it('should freeze funds', async () => {
      mockWalletService.freeze.mockResolvedValue({
        freezeId: 'freeze-1',
        frozenAmount: 50,
      });

      const result = await controller.freeze(
        { userId: 1, username: 'test' },
        {
          currency: 'POINT',
          amount: 50,
          reason: 'game',
          idempotencyKey: 'key2',
        },
      );

      expect(result.freezeId).toBe('freeze-1');
      expect(mockWalletService.freeze).toHaveBeenCalledWith(
        1, 'POINT', 50, 'game', 'key2',
      );
    });
  });

  describe('unfreeze', () => {
    it('should unfreeze funds', async () => {
      const mockTx: Partial<Transaction> = {
        tx_id: 'unfreeze-1',
        tx_type: TransactionType.UNFREEZE,
        amount: '50',
      };
      mockWalletService.unfreeze.mockResolvedValue(mockTx);

      const result = await controller.unfreeze(
        { userId: 1, username: 'test' },
        { freezeId: 'freeze-1', idempotencyKey: 'key3' },
      );

      expect(result.tx_type).toBe(TransactionType.UNFREEZE);
    });
  });

  describe('settle', () => {
    it('should batch settle', async () => {
      mockWalletService.settle.mockResolvedValue(['tx-1', 'tx-2']);

      const result = await controller.settle({
        settlements: [
          { userId: 1, currency: 'POINT', amount: 100, reason: 'win' },
          { userId: 2, currency: 'POINT', amount: -50, reason: 'loss' },
        ],
        idempotencyKey: 'batch-key',
      });

      expect(result).toEqual(['tx-1', 'tx-2']);
    });
  });

  describe('getHistory', () => {
    it('should return transaction history', async () => {
      const mockPaginatedResult = {
        items: [
          {
            tx_id: '1',
            user_id: '1',
            tx_type: TransactionType.TRANSFER_IN,
            amount: '100',
            currency: 'POINT',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      };
      mockWalletService.getHistory.mockResolvedValue(mockPaginatedResult);

      const result = await controller.getHistory(
        { userId: 1, username: 'test' },
        'POINT',
        1,
        20,
      );

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });
});
