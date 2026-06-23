/**
 * Plugin Entity - 插件注册表
 * 记录每个插件的元数据与加载路径，框架启动时据此扫描并初始化插件实例
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum PluginCategory {
  BOARD = 'board',
  CARD = 'card',
  MAHJONG = 'mahjong',
}

@Entity('plugins')
export class Plugin {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  plugin_id: string;

  @Column({ type: 'varchar', length: 128, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 16, nullable: false })
  version: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  game_type: string;

  @Column({
    type: 'enum',
    enum: PluginCategory,
    nullable: false,
  })
  category: PluginCategory;

  @Column({ type: 'int', nullable: false })
  min_players: number;

  @Column({ type: 'int', nullable: false })
  max_players: number;

  @Column({ type: 'varchar', length: 255, nullable: false })
  entry_class: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  dll_path: string | null;

  @Column({ type: 'boolean', nullable: false, default: true })
  is_enabled: boolean;

  @Column({ type: 'jsonb', nullable: false, default: {} })
  meta_json: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  installed_at: Date;
}
