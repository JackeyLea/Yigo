import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';
import { Platform } from '../entities';

export class SendPushDto {
  @IsNotEmpty()
  @IsInt()
  userId: number;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  body: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}

export class BroadcastPushDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  body: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsOptional()
  platforms?: Platform[];

  @IsOptional()
  @IsInt()
  minLevel?: number;

  @IsOptional()
  @IsInt()
  maxLevel?: number;

  @IsOptional()
  vipOnly?: boolean;

  @IsOptional()
  gameTypes?: string[];
}

export class RoomInvitePushDto {
  @IsNotEmpty()
  @IsInt()
  inviterId: number;

  @IsNotEmpty()
  @IsInt()
  inviteeId: number;

  @IsNotEmpty()
  @IsString()
  roomId: string;
}

export class GameReminderPushDto {
  @IsNotEmpty()
  @IsInt()
  userId: number;

  @IsNotEmpty()
  @IsString()
  roomId: string;
}
