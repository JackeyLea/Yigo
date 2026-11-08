/**
 * Seeder Runner - 按顺序执行种子数据脚本
 *
 * 用法: npm run seed
 *
 * 每个 seeder 只会执行一次（记录在 seeders 表中）。
 * 使用 --force 可跳过记录重复执行（幂等性由 seeder 自行保证）。
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';

// 各 seeder 按文件名顺序执行
const SEEDERS: Array<{ name: string; run: () => Promise<void>; rollback?: () => Promise<void> }> = [];

async function loadSeeders(dataSource: DataSource): Promise<void> {
  const seederModules = [
    './01-SeedPlugins',
    './02-SeedAchievements',
    './03-SeedUsers',
  ];

  for (const modulePath of seederModules) {
    const module = require(path.join(__dirname, modulePath));
    const exporterKey = Object.keys(module).find(
      (k) => k !== 'MigrationInterface' && typeof module[k] === 'function',
    );
    if (!exporterKey) {
      throw new Error(`No MigrationInterface export found in ${modulePath}`);
    }
    const SeederClass = module[exporterKey];
    const seeder = new SeederClass();
    SEEDERS.push({
      name: exporterKey,
      run: () => seeder.up(dataSource.createQueryRunner()),
      rollback: () => seeder.down(dataSource.createQueryRunner()),
    });
  }
}

async function ensureSeedersTable(dataSource: DataSource): Promise<void> {
  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS seeders (
      name varchar(64) PRIMARY KEY,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'chess_platform_db',
  });

  try {
    await dataSource.initialize();
    await ensureSeedersTable(dataSource);
    await loadSeeders(dataSource);

    let executed = 0;
    for (const seeder of SEEDERS) {
      const existing = await dataSource.query(
        'SELECT name FROM seeders WHERE name = $1',
        [seeder.name],
      );
      if (existing.length > 0 && !force) {
        console.log(`- ${seeder.name}: already executed, skipping`);
        continue;
      }

      console.log(`Running ${seeder.name}...`);
      await seeder.run();
      await dataSource.query(
        'INSERT INTO seeders (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [seeder.name],
      );
      console.log(`✓ ${seeder.name} completed`);
      executed++;
    }

    console.log(`\nSeed completed: ${executed} executed, ${SEEDERS.length - executed} skipped`);
    await dataSource.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err?.message || err);
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
    process.exit(1);
  }
}

// 仅在直接执行本文件时运行（避免被 TypeORM migrations glob 加载时误执行）
if (require.main === module) {
  main();
}
