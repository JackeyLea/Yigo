/**
 * Initial Schema Migration
 * 创建通用棋牌游戏框架的10张核心表
 */
import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey, TableUnique } from 'typeorm';

export class InitialSchema20240623000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema = queryRunner.connection.driver.schema || 'public';

    // ============================================================
    // 1. users 用户表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          { name: 'user_id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'username', type: 'varchar', length: '32', isNullable: false },
          { name: 'password_hash', type: 'varchar', length: '255', isNullable: false },
          { name: 'email', type: 'varchar', length: '255', isNullable: true },
          { name: 'phone', type: 'varchar', length: '20', isNullable: true },
          { name: 'avatar_url', type: 'varchar', length: '500', isNullable: true },
          { name: 'nickname', type: 'varchar', length: '32', isNullable: false, default: "'Player'" },
          { name: 'level', type: 'int', isNullable: false, default: 1 },
          { name: 'xp', type: 'bigint', isNullable: false, default: 0 },
          { name: 'status', type: 'enum', enum: ['active', 'banned', 'inactive'], isNullable: false, default: "'active'" },
          { name: 'last_login_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'deleted_at', type: 'timestamptz', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('users', new TableIndex({ name: 'IDX_users_username', columnNames: ['username'], isUnique: true }));
    await queryRunner.createIndex('users', new TableIndex({ name: 'IDX_users_email', columnNames: ['email'], isUnique: true, where: 'email IS NOT NULL' }));
    await queryRunner.createIndex('users', new TableIndex({ name: 'IDX_users_phone', columnNames: ['phone'], isUnique: true, where: 'phone IS NOT NULL' }));

    // ============================================================
    // 2. plugins 插件注册表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'plugins',
        columns: [
          { name: 'plugin_id', type: 'varchar', length: '32', isPrimary: true },
          { name: 'name', type: 'varchar', length: '128', isNullable: false },
          { name: 'version', type: 'varchar', length: '16', isNullable: false },
          { name: 'game_type', type: 'varchar', length: '32', isNullable: false },
          { name: 'category', type: 'enum', enum: ['board', 'card', 'mahjong'], isNullable: false },
          { name: 'min_players', type: 'int', isNullable: false },
          { name: 'max_players', type: 'int', isNullable: false },
          { name: 'entry_class', type: 'varchar', length: '255', isNullable: false },
          { name: 'dll_path', type: 'varchar', length: '500', isNullable: true },
          { name: 'is_enabled', type: 'boolean', isNullable: false, default: true },
          { name: 'meta_json', type: 'jsonb', isNullable: false, default: "'{}'" },
          { name: 'installed_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    );

    // ============================================================
    // 3. achievements 成就定义表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'achievements',
        columns: [
          { name: 'achievement_id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'achievement_code', type: 'varchar', length: '64', isNullable: false },
          { name: 'name', type: 'varchar', length: '128', isNullable: false },
          { name: 'description', type: 'varchar', length: '500', isNullable: false },
          { name: 'icon_url', type: 'varchar', length: '500', isNullable: true },
          { name: 'game_type', type: 'varchar', length: '32', isNullable: true },
          { name: 'unlock_condition_json', type: 'jsonb', isNullable: false },
          { name: 'reward_json', type: 'jsonb', isNullable: false },
          { name: 'category', type: 'enum', enum: ['cross_game', 'game_specific', 'event'], isNullable: false },
          { name: 'is_hidden', type: 'boolean', isNullable: false, default: false },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('achievements', new TableIndex({ name: 'IDX_achievements_code', columnNames: ['achievement_code'], isUnique: true }));

    // ============================================================
    // 4. wallets 用户钱包表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'wallets',
        columns: [
          { name: 'wallet_id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'user_id', type: 'bigint', isNullable: false },
          { name: 'currency', type: 'varchar', length: '16', isNullable: false },
          { name: 'balance', type: 'decimal', precision: 18, scale: 4, isNullable: false, default: 0 },
          { name: 'frozen', type: 'decimal', precision: 18, scale: 4, isNullable: false, default: 0 },
          { name: 'total_deposited', type: 'decimal', precision: 18, scale: 4, isNullable: false, default: 0 },
          { name: 'total_withdrawn', type: 'decimal', precision: 18, scale: 4, isNullable: false, default: 0 },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'UQ_wallets_user_currency', columnNames: ['user_id', 'currency'] }),
        ],
      }),
      true,
    );

    await queryRunner.createIndex('wallets', new TableIndex({ name: 'IDX_wallets_user_id', columnNames: ['user_id'] }));
    await queryRunner.createForeignKey('wallets', new TableForeignKey({
      name: 'FK_wallets_user_id',
      columnNames: ['user_id'],
      referencedTableName: 'users',
      referencedColumnNames: ['user_id'],
      onDelete: 'CASCADE',
    }));

    // ============================================================
    // 5. rooms 房间表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'rooms',
        columns: [
          { name: 'room_id', type: 'varchar', length: '32', isPrimary: true },
          { name: 'game_type', type: 'varchar', length: '32', isNullable: false },
          { name: 'plugin_id', type: 'varchar', length: '32', isNullable: false },
          { name: 'status', type: 'enum', enum: ['waiting', 'playing', 'paused', 'finished'], isNullable: false, default: "'waiting'" },
          { name: 'host_id', type: 'bigint', isNullable: false },
          { name: 'max_players', type: 'int', isNullable: false },
          { name: 'current_players', type: 'int', isNullable: false, default: 0 },
          { name: 'config_json', type: 'jsonb', isNullable: false, default: "'{}'" },
          { name: 'mode', type: 'varchar', length: '32', isNullable: false, default: "'normal'" },
          { name: 'password_hash', type: 'varchar', length: '255', isNullable: true },
          { name: 'is_spectator_allowed', type: 'boolean', isNullable: false, default: true },
          { name: 'spectator_count', type: 'int', isNullable: false, default: 0 },
          { name: 'current_round', type: 'int', isNullable: false, default: 0 },
          { name: 'state_json', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'expired_at', type: 'timestamptz', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('rooms', new TableIndex({ name: 'IDX_rooms_host_id', columnNames: ['host_id'] }));
    await queryRunner.createIndex('rooms', new TableIndex({ name: 'IDX_rooms_status', columnNames: ['status'] }));
    await queryRunner.createIndex('rooms', new TableIndex({ name: 'IDX_rooms_game_type', columnNames: ['game_type'] }));
    await queryRunner.createForeignKey('rooms', new TableForeignKey({
      name: 'FK_rooms_host_id',
      columnNames: ['host_id'],
      referencedTableName: 'users',
      referencedColumnNames: ['user_id'],
      onDelete: 'CASCADE',
    }));

    // ============================================================
    // 6. room_players 房间玩家关联表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'room_players',
        columns: [
          { name: 'id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'room_id', type: 'varchar', length: '32', isNullable: false },
          { name: 'user_id', type: 'bigint', isNullable: false },
          { name: 'seat_index', type: 'int', isNullable: false },
          { name: 'is_ready', type: 'boolean', isNullable: false, default: false },
          { name: 'is_host', type: 'boolean', isNullable: false, default: false },
          { name: 'is_ai', type: 'boolean', isNullable: false, default: false },
          { name: 'ai_difficulty', type: 'varchar', length: '16', isNullable: true },
          { name: 'joined_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'left_at', type: 'timestamptz', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('room_players', new TableIndex({ name: 'IDX_room_players_room_id', columnNames: ['room_id'] }));
    await queryRunner.createIndex('room_players', new TableIndex({ name: 'IDX_room_players_user_id', columnNames: ['user_id'] }));
    await queryRunner.createForeignKey('room_players', new TableForeignKey({
      name: 'FK_room_players_room_id',
      columnNames: ['room_id'],
      referencedTableName: 'rooms',
      referencedColumnNames: ['room_id'],
      onDelete: 'CASCADE',
    }));
    await queryRunner.createForeignKey('room_players', new TableForeignKey({
      name: 'FK_room_players_user_id',
      columnNames: ['user_id'],
      referencedTableName: 'users',
      referencedColumnNames: ['user_id'],
      onDelete: 'CASCADE',
    }));

    // ============================================================
    // 7. game_records 对局记录表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'game_records',
        columns: [
          { name: 'record_id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'room_id', type: 'varchar', length: '32', isNullable: false },
          { name: 'game_type', type: 'varchar', length: '32', isNullable: false },
          { name: 'plugin_id', type: 'varchar', length: '32', isNullable: false },
          { name: 'start_time', type: 'timestamptz', isNullable: false },
          { name: 'end_time', type: 'timestamptz', isNullable: true },
          { name: 'players_json', type: 'jsonb', isNullable: false },
          { name: 'result_json', type: 'jsonb', isNullable: true },
          { name: 'actions_json', type: 'jsonb', isNullable: true },
          { name: 'replay_data_url', type: 'varchar', length: '500', isNullable: true },
          { name: 'status', type: 'enum', enum: ['in_progress', 'completed', 'aborted'], isNullable: false },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('game_records', new TableIndex({ name: 'IDX_game_records_room_id', columnNames: ['room_id'] }));
    await queryRunner.createIndex('game_records', new TableIndex({ name: 'IDX_game_records_game_type', columnNames: ['game_type'] }));
    await queryRunner.createIndex('game_records', new TableIndex({ name: 'IDX_game_records_status', columnNames: ['status'] }));
    await queryRunner.createForeignKey('game_records', new TableForeignKey({
      name: 'FK_game_records_room_id',
      columnNames: ['room_id'],
      referencedTableName: 'rooms',
      referencedColumnNames: ['room_id'],
      onDelete: 'CASCADE',
    }));

    // ============================================================
    // 8. leaderboard_entries 排行榜条目表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'leaderboard_entries',
        columns: [
          { name: 'entry_id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'game_type', type: 'varchar', length: '32', isNullable: false },
          { name: 'plugin_id', type: 'varchar', length: '32', isNullable: false },
          { name: 'user_id', type: 'bigint', isNullable: false },
          { name: 'season_id', type: 'varchar', length: '32', isNullable: false, default: "'all_time'" },
          { name: 'rating_score', type: 'int', isNullable: false, default: 1000 },
          { name: 'games_played', type: 'int', isNullable: false, default: 0 },
          { name: 'games_won', type: 'int', isNullable: false, default: 0 },
          { name: 'games_drawn', type: 'int', isNullable: false, default: 0 },
          { name: 'games_lost', type: 'int', isNullable: false, default: 0 },
          { name: 'best_streak', type: 'int', isNullable: false, default: 0 },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'UQ_leaderboard_entries_game_season_user', columnNames: ['game_type', 'season_id', 'user_id'] }),
        ],
      }),
      true,
    );

    await queryRunner.createIndex('leaderboard_entries', new TableIndex({ name: 'IDX_leaderboard_user_id', columnNames: ['user_id'] }));
    await queryRunner.createIndex('leaderboard_entries', new TableIndex({ name: 'IDX_leaderboard_game_season_score', columnNames: ['game_type', 'season_id', 'rating_score'] }));
    await queryRunner.createForeignKey('leaderboard_entries', new TableForeignKey({
      name: 'FK_leaderboard_entries_user_id',
      columnNames: ['user_id'],
      referencedTableName: 'users',
      referencedColumnNames: ['user_id'],
      onDelete: 'CASCADE',
    }));

    // ============================================================
    // 9. user_achievements 用户成就进度表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'user_achievements',
        columns: [
          { name: 'id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'user_id', type: 'bigint', isNullable: false },
          { name: 'achievement_id', type: 'bigint', isNullable: false },
          { name: 'unlocked_at', type: 'timestamptz', isNullable: true },
          { name: 'progress_json', type: 'jsonb', isNullable: false, default: "'{}'" },
          { name: 'is_claimed', type: 'boolean', isNullable: false, default: false },
        ],
        uniques: [
          new TableUnique({ name: 'UQ_user_achievements_user_achievement', columnNames: ['user_id', 'achievement_id'] }),
        ],
      }),
      true,
    );

    await queryRunner.createIndex('user_achievements', new TableIndex({ name: 'IDX_user_achievements_user_id', columnNames: ['user_id'] }));
    await queryRunner.createIndex('user_achievements', new TableIndex({ name: 'IDX_user_achievements_achievement_id', columnNames: ['achievement_id'] }));
    await queryRunner.createForeignKey('user_achievements', new TableForeignKey({
      name: 'FK_user_achievements_user_id',
      columnNames: ['user_id'],
      referencedTableName: 'users',
      referencedColumnNames: ['user_id'],
      onDelete: 'CASCADE',
    }));
    await queryRunner.createForeignKey('user_achievements', new TableForeignKey({
      name: 'FK_user_achievements_achievement_id',
      columnNames: ['achievement_id'],
      referencedTableName: 'achievements',
      referencedColumnNames: ['achievement_id'],
      onDelete: 'CASCADE',
    }));

    // ============================================================
    // 10. transactions 资产流水表
    // ============================================================
    await queryRunner.createTable(
      new Table({
        name: 'transactions',
        columns: [
          { name: 'tx_id', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'user_id', type: 'bigint', isNullable: false },
          { name: 'tx_type', type: 'enum', enum: ['deposit', 'withdraw', 'transfer_in', 'transfer_out', 'freeze', 'unfreeze', 'game_settle'], isNullable: false },
          { name: 'amount', type: 'decimal', precision: 18, scale: 4, isNullable: false },
          { name: 'currency', type: 'varchar', length: '16', isNullable: false },
          { name: 'balance_after', type: 'decimal', precision: 18, scale: 4, isNullable: false },
          { name: 'reference_id', type: 'varchar', length: '64', isNullable: true },
          { name: 'reference_type', type: 'varchar', length: '32', isNullable: true },
          { name: 'idempotency_key', type: 'varchar', length: '64', isNullable: false },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('transactions', new TableIndex({ name: 'IDX_transactions_user_id', columnNames: ['user_id'] }));
    await queryRunner.createIndex('transactions', new TableIndex({ name: 'IDX_transactions_idempotency_key', columnNames: ['idempotency_key'], isUnique: true }));
    await queryRunner.createIndex('transactions', new TableIndex({ name: 'IDX_transactions_reference', columnNames: ['reference_id', 'reference_type'] }));
    await queryRunner.createForeignKey('transactions', new TableForeignKey({
      name: 'FK_transactions_user_id',
      columnNames: ['user_id'],
      referencedTableName: 'users',
      referencedColumnNames: ['user_id'],
      onDelete: 'CASCADE',
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse dependency order
    await queryRunner.dropTable('transactions', true, true, true);
    await queryRunner.dropTable('user_achievements', true, true, true);
    await queryRunner.dropTable('leaderboard_entries', true, true, true);
    await queryRunner.dropTable('game_records', true, true, true);
    await queryRunner.dropTable('room_players', true, true, true);
    await queryRunner.dropTable('rooms', true, true, true);
    await queryRunner.dropTable('wallets', true, true, true);
    await queryRunner.dropTable('achievements', true, true, true);
    await queryRunner.dropTable('plugins', true, true, true);
    await queryRunner.dropTable('users', true, true, true);
  }
}
