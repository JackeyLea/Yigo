/**
 * User Seeder
 * 种子数据：创建系统默认账户、测试用户及对应的钱包数据
 */
import { MigrationInterface, QueryRunner } from 'typeorm';
import * as argon2 from 'argon2';

export interface UserSeedData {
  username: string;
  password_hash: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  nickname: string;
  level: number;
  xp: number;
  status: string;
}

export interface WalletSeedData {
  username: string;
  currency: string;
  balance: number;
}

// 默认密码 'password123'，使用与 AuthService 一致的 argon2id 算法运行时生成
const DEFAULT_PASSWORD_HASH = ''; // 在 up() 中惰性生成

const USER_SEEDS: UserSeedData[] = [
  {
    username: 'admin',
    password_hash: DEFAULT_PASSWORD_HASH,
    email: 'admin@chess-platform.com',
    phone: null,
    avatar_url: '/assets/avatars/admin.png',
    nickname: '系统管理员',
    level: 99,
    xp: 999999,
    status: 'active',
  },
  {
    username: 'test_player',
    password_hash: DEFAULT_PASSWORD_HASH,
    email: 'test@chess-platform.com',
    phone: '13800138000',
    avatar_url: '/assets/avatars/default_01.png',
    nickname: '测试玩家',
    level: 10,
    xp: 5000,
    status: 'active',
  },
  {
    username: 'ai_easy',
    password_hash: DEFAULT_PASSWORD_HASH,
    email: null,
    phone: null,
    avatar_url: '/assets/avatars/ai_easy.png',
    nickname: '简单AI',
    level: 1,
    xp: 0,
    status: 'active',
  },
  {
    username: 'ai_medium',
    password_hash: DEFAULT_PASSWORD_HASH,
    email: null,
    phone: null,
    avatar_url: '/assets/avatars/ai_medium.png',
    nickname: '中等AI',
    level: 1,
    xp: 0,
    status: 'active',
  },
  {
    username: 'ai_hard',
    password_hash: DEFAULT_PASSWORD_HASH,
    email: null,
    phone: null,
    avatar_url: '/assets/avatars/ai_hard.png',
    nickname: '困难AI',
    level: 1,
    xp: 0,
    status: 'active',
  },
  {
    username: 'demo_user1',
    password_hash: DEFAULT_PASSWORD_HASH,
    email: 'demo1@chess-platform.com',
    phone: null,
    avatar_url: '/assets/avatars/default_02.png',
    nickname: '演示用户A',
    level: 5,
    xp: 1200,
    status: 'active',
  },
  {
    username: 'demo_user2',
    password_hash: DEFAULT_PASSWORD_HASH,
    email: 'demo2@chess-platform.com',
    phone: null,
    avatar_url: '/assets/avatars/default_03.png',
    nickname: '演示用户B',
    level: 5,
    xp: 1500,
    status: 'active',
  },
  {
    username: 'demo_user3',
    password_hash: DEFAULT_PASSWORD_HASH,
    email: 'demo3@chess-platform.com',
    phone: null,
    avatar_url: '/assets/avatars/default_04.png',
    nickname: '演示用户C',
    level: 3,
    xp: 800,
    status: 'active',
  },
];

const WALLET_SEEDS: WalletSeedData[] = [
  { username: 'admin', currency: 'coin', balance: 999999.9999 },
  { username: 'admin', currency: 'diamond', balance: 99999.9999 },
  { username: 'test_player', currency: 'coin', balance: 10000.0000 },
  { username: 'test_player', currency: 'diamond', balance: 500.0000 },
  { username: 'test_player', currency: 'chip', balance: 5000.0000 },
  { username: 'demo_user1', currency: 'coin', balance: 5000.0000 },
  { username: 'demo_user1', currency: 'chip', balance: 1000.0000 },
  { username: 'demo_user2', currency: 'coin', balance: 3000.0000 },
  { username: 'demo_user2', currency: 'happy_bean', balance: 2000.0000 },
  { username: 'demo_user3', currency: 'coin', balance: 2000.0000 },
];

export class SeedUsers implements MigrationInterface {
  name = 'SeedUsers';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = new Date();
    const createdUsers: Map<string, string> = new Map(); // username -> user_id

    // 生成与 AuthService 一致的 argon2id 哈希
    const passwordHash = await argon2.hash('password123', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // 1. Insert users
    for (const user of USER_SEEDS) {
      const result = await queryRunner.query(
        `INSERT INTO users (
          username, password_hash, email, phone, avatar_url,
          nickname, level, xp, status, last_login_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (username) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          avatar_url = EXCLUDED.avatar_url,
          nickname = EXCLUDED.nickname,
          level = EXCLUDED.level,
          xp = EXCLUDED.xp,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
        RETURNING user_id`,
        [
          user.username,
          user.password_hash || passwordHash,
          user.email,
          user.phone,
          user.avatar_url,
          user.nickname,
          user.level,
          user.xp,
          user.status,
          now,
          now,
          now,
        ],
      );

      const userId = result[0]?.user_id;
      if (userId) {
        createdUsers.set(user.username, userId);
      }
    }

    console.log(`[Seeder] Inserted/updated ${createdUsers.size} users.`);

    // 2. Insert wallets
    let walletCount = 0;
    for (const wallet of WALLET_SEEDS) {
      const userId = createdUsers.get(wallet.username);
      if (!userId) {
        console.warn(`[Seeder] User not found for wallet: ${wallet.username}`);
        continue;
      }

      await queryRunner.query(
        `INSERT INTO wallets (
          user_id, currency, balance, frozen,
          total_deposited, total_withdrawn, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, currency) DO UPDATE SET
          balance = EXCLUDED.balance,
          updated_at = EXCLUDED.updated_at`,
        [
          userId,
          wallet.currency,
          wallet.balance,
          0, // frozen
          wallet.balance, // total_deposited
          0, // total_withdrawn
          now,
        ],
      );
      walletCount++;
    }

    console.log(`[Seeder] Inserted/updated ${walletCount} wallets.`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const usernames = USER_SEEDS.map((u) => u.username);

    // Wallets will be cascade-deleted with users
    await queryRunner.query(
      `DELETE FROM users WHERE username = ANY($1)`,
      [usernames],
    );

    console.log(`[Seeder] Removed ${usernames.length} users and their wallets.`);
  }
}
