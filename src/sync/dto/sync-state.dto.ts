import { IsString, IsNumber, IsObject, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { GameState, Action } from '../../plugin/interfaces/game-controller.interface';

/**
 * SyncStateDto - 状态同步数据传输对象
 *
 * 用于棋类游戏的完整状态同步，包含CRC32校验防止传输错误
 */
export class SyncStateDto {
  @IsString()
  roomId: string;

  @IsObject()
  @Type(() => Object)
  state: GameState;

  @IsNumber()
  timestamp: number;

  @IsNumber()
  frameSeq: number;

  @IsString()
  checksum: string; // CRC32校验
}

/**
 * SyncActionDto - 操作指令同步DTO
 *
 * 用于牌类游戏的增量同步，只发送操作指令而非完整状态
 */
export class SyncActionDto {
  @IsString()
  roomId: string;

  @IsObject()
  @Type(() => Object)
  action: Action;

  @IsNumber()
  timestamp: number;

  @IsNumber()
  frameSeq: number;

  @IsString()
  checksum: string; // CRC32校验
}

/**
 * HiddenCardsHashDto - 不可见牌区哈希同步DTO
 *
 * 使用HMAC-SHA256保护不可见牌区，防止作弊
 */
export class HiddenCardsHashDto {
  @IsString()
  roomId: string;

  @IsString()
  playerId: string;

  @IsString()
  hash: string; // HMAC-SHA256哈希值

  @IsNumber()
  timestamp: number;

  @IsString()
  @IsOptional()
  nonce?: string; // nonce的base64表示，用于验证
}

/**
 * KeyframeSyncDto - 关键帧同步DTO
 *
 * 每秒发送一次完整状态，用于冗余校验
 */
export class KeyframeSyncDto {
  @IsString()
  roomId: string;

  @IsObject()
  @Type(() => Object)
  state: GameState;

  @IsNumber()
  timestamp: number;

  @IsNumber()
  keyframeSeq: number;

  @IsString()
  checksum: string;
}

/**
 * SpectatorPushDto - 观战推送DTO
 *
 * 观战者延迟接收的状态数据
 */
export class SpectatorPushDto {
  @IsString()
  roomId: string;

  @IsObject()
  @Type(() => Object)
  state: GameState;

  @IsNumber()
  timestamp: number;

  @IsNumber()
  delaySeconds: number;
}

/**
 * Card 定义 - 牌类游戏中的单张牌
 */
export interface Card {
  suit: string; // 花色
  rank: string; // 点数
  id?: string;  // 唯一标识
}

/**
 * ReplayData - 回放数据格式
 */
export interface ReplayData {
  recordId: string;
  roomId: string;
  players: Array<{
    playerId: string;
    seatIndex: number;
    nickname?: string;
  }>;
  gameType: string;
  actions: ReplayAction[];
  startTime: number;
  endTime?: number;
  finalState?: GameState;
}

/**
 * ReplayAction - 带时间戳的回放操作
 */
export interface ReplayAction {
  index: number;
  timestamp: number;
  action: Action;
  stateSnapshot?: GameState;
}
