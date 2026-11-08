import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import Redis from 'ioredis';
import { Wallet } from '../common/entities/wallet.entity';
import {
  Transaction,
  TransactionType,
} from '../common/entities/transaction.entity';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';

export interface Settlement {
  userId: number;
  currency: string;
  amount: number;
  reason: string;
}

export interface FreezeResult {
  freezeId: string;
  frozenAmount: number;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly dataSource: DataSource,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB, 10) || 0,
      keyPrefix: 'wallet:',
    });
  }

  /**
   * Check idempotency using Redis SETNX
   * Returns true if the key is new (operation can proceed), false if duplicate
   */
  private async checkIdempotency(
    idempotencyKey: string,
    ttlSeconds: number = 86400,
  ): Promise<boolean> {
    const redisKey = `idempotent:${idempotencyKey}`;
    const result = await this.redis.setnx(redisKey, '1');
    if (result === 1) {
      await this.redis.expire(redisKey, ttlSeconds);
      return true;
    }
    return false;
  }

  /**
   * Get wallet by userId and currency, creating if not exists
   */
  private async getOrCreateWallet(
    userId: string,
    currency: string,
    manager?: any,
  ): Promise<Wallet> {
    const repo = manager
      ? manager.getRepository(Wallet)
      : this.walletRepository;

    let wallet = await repo.findOne({
      where: { user_id: userId, currency },
    });

    if (!wallet) {
      wallet = repo.create({
        user_id: userId,
        currency,
        balance: '0',
        frozen: '0',
        total_deposited: '0',
        total_withdrawn: '0',
      });
      wallet = await repo.save(wallet);
    }

    return wallet;
  }

  /**
   * Query balance for a user
   * If currency is specified, returns single wallet; otherwise returns all wallets
   */
  async getBalance(
    userId: number,
    currency?: string,
  ): Promise<Wallet | Wallet[]> {
    if (currency) {
      const wallet = await this.getOrCreateWallet(String(userId), currency);
      return wallet;
    }

    const wallets = await this.walletRepository.find({
      where: { user_id: String(userId) },
    });

    return wallets;
  }

  /**
   * Transfer funds from one user to another
   * Uses transaction for atomicity and Redis for idempotency
   */
  async transfer(
    fromUserId: number,
    toUserId: number,
    currency: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<Transaction> {
    if (fromUserId === toUserId) {
      throw new BadRequestException('Cannot transfer to yourself');
    }
    if (amount <= 0) {
      throw new BadRequestException('Transfer amount must be positive');
    }

    // Check idempotency
    const isNew = await this.checkIdempotency(idempotencyKey);
    if (!isNew) {
      // Return existing transaction
      const existingTx = await this.transactionRepository.findOne({
        where: { idempotency_key: idempotencyKey },
      });
      if (existingTx) {
        return existingTx;
      }
      throw new ConflictException('Duplicate request being processed');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      const manager = queryRunner.manager;

      // Lock and get source wallet
      const sourceWallet = await manager
        .createQueryBuilder(Wallet, 'wallet')
        .setLock('pessimistic_write')
        .where('wallet.user_id = :userId AND wallet.currency = :currency', {
          userId: String(fromUserId),
          currency,
        })
        .getOne();

      if (!sourceWallet) {
        throw new BadRequestException('Source wallet not found');
      }

      const currentBalance = parseFloat(sourceWallet.balance);
      if (currentBalance < amount) {
        throw new BadRequestException('Insufficient balance');
      }

      // Lock and get target wallet
      let targetWallet = await manager
        .createQueryBuilder(Wallet, 'wallet')
        .setLock('pessimistic_write')
        .where('wallet.user_id = :userId AND wallet.currency = :currency', {
          userId: String(toUserId),
          currency,
        })
        .getOne();

      if (!targetWallet) {
        targetWallet = manager.create(Wallet, {
          user_id: String(toUserId),
          currency,
          balance: '0',
          frozen: '0',
          total_deposited: '0',
          total_withdrawn: '0',
        });
        targetWallet = await manager.save(Wallet, targetWallet);
      }

      // Update balances
      const newSourceBalance = (currentBalance - amount).toFixed(4);
      const newTargetBalance = (parseFloat(targetWallet.balance) + amount).toFixed(4);

      sourceWallet.balance = newSourceBalance;
      targetWallet.balance = newTargetBalance;
      targetWallet.total_deposited = (
        parseFloat(targetWallet.total_deposited) + amount
      ).toFixed(4);
      sourceWallet.total_withdrawn = (
        parseFloat(sourceWallet.total_withdrawn) + amount
      ).toFixed(4);

      await manager.save(Wallet, sourceWallet);
      await manager.save(Wallet, targetWallet);

      // Create transaction records
      const txRepo = manager.getRepository(Transaction);

      const outTx = txRepo.create({
        user_id: String(fromUserId),
        tx_type: TransactionType.TRANSFER_OUT,
        amount: (-amount).toFixed(4),
        currency,
        balance_after: newSourceBalance,
        reference_id: String(toUserId),
        reference_type: 'transfer',
        idempotency_key: `${idempotencyKey}:out`,
      });

      const inTx = txRepo.create({
        user_id: String(toUserId),
        tx_type: TransactionType.TRANSFER_IN,
        amount: amount.toFixed(4),
        currency,
        balance_after: newTargetBalance,
        reference_id: String(fromUserId),
        reference_type: 'transfer',
        idempotency_key: `${idempotencyKey}:in`,
      });

      await txRepo.save(outTx);
      await txRepo.save(inTx);

      await queryRunner.commitTransaction();

      this.logger.log(
        `Transfer: ${fromUserId} -> ${toUserId}, ${amount} ${currency}, reason: ${reason}`,
      );

      return inTx;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      // Remove idempotency key on failure so client can retry
      await this.redis.del(`idempotent:${idempotencyKey}`);

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Transfer failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Transfer failed');
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Freeze a specified amount in user's wallet
   */
  async freeze(
    userId: number,
    currency: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<FreezeResult> {
    if (amount <= 0) {
      throw new BadRequestException('Freeze amount must be positive');
    }

    const isNew = await this.checkIdempotency(idempotencyKey);
    if (!isNew) {
      const existingTx = await this.transactionRepository.findOne({
        where: { idempotency_key: idempotencyKey },
      });
      if (existingTx) {
        return {
          freezeId: existingTx.tx_id,
          frozenAmount: Math.abs(parseFloat(existingTx.amount)),
        };
      }
      throw new ConflictException('Duplicate request being processed');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      const manager = queryRunner.manager;

      // Lock wallet
      const wallet = await manager
        .createQueryBuilder(Wallet, 'wallet')
        .setLock('pessimistic_write')
        .where('wallet.user_id = :userId AND wallet.currency = :currency', {
          userId: String(userId),
          currency,
        })
        .getOne();

      if (!wallet) {
        throw new BadRequestException('Wallet not found');
      }

      const currentBalance = parseFloat(wallet.balance);
      if (currentBalance < amount) {
        throw new BadRequestException('Insufficient balance to freeze');
      }

      // Move from balance to frozen
      const newBalance = (currentBalance - amount).toFixed(4);
      const newFrozen = (parseFloat(wallet.frozen) + amount).toFixed(4);

      wallet.balance = newBalance;
      wallet.frozen = newFrozen;

      await manager.save(Wallet, wallet);

      // Create transaction record
      const txRepo = manager.getRepository(Transaction);
      const tx = txRepo.create({
        user_id: String(userId),
        tx_type: TransactionType.FREEZE,
        amount: (-amount).toFixed(4),
        currency,
        balance_after: newBalance,
        reference_id: null,
        reference_type: 'freeze',
        idempotency_key: idempotencyKey,
      });

      await txRepo.save(tx);
      await queryRunner.commitTransaction();

      this.logger.log(
        `Freeze: user ${userId}, ${amount} ${currency}, freezeId: ${tx.tx_id}, reason: ${reason}`,
      );

      return {
        freezeId: tx.tx_id,
        frozenAmount: amount,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      await this.redis.del(`idempotent:${idempotencyKey}`);

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Freeze failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Freeze failed');
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Unfreeze previously frozen funds
   */
  async unfreeze(
    freezeId: string,
    idempotencyKey: string,
  ): Promise<Transaction> {
    const isNew = await this.checkIdempotency(idempotencyKey);
    if (!isNew) {
      const existingTx = await this.transactionRepository.findOne({
        where: { idempotency_key: idempotencyKey },
      });
      if (existingTx) {
        return existingTx;
      }
      throw new ConflictException('Duplicate request being processed');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      const manager = queryRunner.manager;

      // Get the original freeze transaction
      const freezeTx = await manager
        .createQueryBuilder(Transaction, 'tx')
        .setLock('pessimistic_write')
        .where('tx.tx_id = :freezeId AND tx.tx_type = :txType', {
          freezeId,
          txType: TransactionType.FREEZE,
        })
        .getOne();

      if (!freezeTx) {
        throw new NotFoundException('Freeze record not found');
      }

      const userId = freezeTx.user_id;
      const currency = freezeTx.currency;
      const amount = Math.abs(parseFloat(freezeTx.amount));

      // Lock wallet
      const wallet = await manager
        .createQueryBuilder(Wallet, 'wallet')
        .setLock('pessimistic_write')
        .where('wallet.user_id = :userId AND wallet.currency = :currency', {
          userId,
          currency,
        })
        .getOne();

      if (!wallet) {
        throw new BadRequestException('Wallet not found');
      }

      const currentFrozen = parseFloat(wallet.frozen);
      if (currentFrozen < amount) {
        throw new BadRequestException('Insufficient frozen amount to unfreeze');
      }

      // Move from frozen back to balance
      const newBalance = (parseFloat(wallet.balance) + amount).toFixed(4);
      const newFrozen = (currentFrozen - amount).toFixed(4);

      wallet.balance = newBalance;
      wallet.frozen = newFrozen;

      await manager.save(Wallet, wallet);

      // Create unfreeze transaction record
      const txRepo = manager.getRepository(Transaction);
      const tx = txRepo.create({
        user_id: userId,
        tx_type: TransactionType.UNFREEZE,
        amount: amount.toFixed(4),
        currency,
        balance_after: newBalance,
        reference_id: freezeId,
        reference_type: 'unfreeze',
        idempotency_key: idempotencyKey,
      });

      await txRepo.save(tx);
      await queryRunner.commitTransaction();

      this.logger.log(
        `Unfreeze: user ${userId}, ${amount} ${currency}, freezeId: ${freezeId}`,
      );

      return tx;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      await this.redis.del(`idempotent:${idempotencyKey}`);

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Unfreeze failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Unfreeze failed');
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Batch settlement - apply multiple balance changes atomically
   * Each settlement can be positive (credit) or negative (debit)
   */
  async settle(
    settlements: Settlement[],
    idempotencyKey: string,
  ): Promise<string[]> {
    if (!settlements || settlements.length === 0) {
      return [];
    }

    const isNew = await this.checkIdempotency(idempotencyKey);
    if (!isNew) {
      // Return existing transaction IDs
      const existingTxs = await this.transactionRepository.find({
        where: { idempotency_key: `${idempotencyKey}:settle` },
      });
      if (existingTxs.length > 0) {
        return existingTxs.map((tx) => tx.tx_id);
      }
      throw new ConflictException('Duplicate request being processed');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    const txIds: string[] = [];

    try {
      const manager = queryRunner.manager;

      for (const settlement of settlements) {
        const { userId, currency, amount, reason } = settlement;

        // Lock wallet
        let wallet = await manager
          .createQueryBuilder(Wallet, 'wallet')
          .setLock('pessimistic_write')
          .where('wallet.user_id = :userId AND wallet.currency = :currency', {
            userId: String(userId),
            currency,
          })
          .getOne();

        if (!wallet) {
          // Auto-create wallet if not exists
          wallet = manager.create(Wallet, {
            user_id: String(userId),
            currency,
            balance: '0',
            frozen: '0',
            total_deposited: '0',
            total_withdrawn: '0',
          });
          wallet = await manager.save(Wallet, wallet);
        }

        const currentBalance = parseFloat(wallet.balance);

        if (amount < 0 && currentBalance < Math.abs(amount)) {
          throw new BadRequestException(
            `Insufficient balance for user ${userId} in ${currency}`,
          );
        }

        const newBalance = (currentBalance + amount).toFixed(4);
        wallet.balance = newBalance;

        if (amount > 0) {
          wallet.total_deposited = (
            parseFloat(wallet.total_deposited) + amount
          ).toFixed(4);
        } else if (amount < 0) {
          wallet.total_withdrawn = (
            parseFloat(wallet.total_withdrawn) + Math.abs(amount)
          ).toFixed(4);
        }

        await manager.save(Wallet, wallet);

        // Create transaction record
        const txRepo = manager.getRepository(Transaction);
        const tx = txRepo.create({
          user_id: String(userId),
          tx_type: TransactionType.GAME_SETTLE,
          amount: amount.toFixed(4),
          currency,
          balance_after: newBalance,
          reference_id: null,
          reference_type: reason || 'settlement',
          idempotency_key: `${idempotencyKey}:settle:${txIds.length}`,
        });

        const savedTx = await txRepo.save(tx);
        txIds.push(savedTx.tx_id);
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `Batch settle: ${settlements.length} entries, idempotencyKey: ${idempotencyKey}`,
      );

      return txIds;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      await this.redis.del(`idempotent:${idempotencyKey}`);

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Settlement failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Settlement failed');
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get transaction history for a user with pagination
   */
  async getHistory(
    userId: number,
    currency?: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<Transaction>> {
    const where: any = { user_id: String(userId) };
    if (currency) {
      where.currency = currency;
    }

    const [items, total] = await this.transactionRepository.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get all wallets for a user
   */
  async getWallets(userId: number): Promise<Wallet[]> {
    return this.walletRepository.find({
      where: { user_id: String(userId) },
    });
  }
}
