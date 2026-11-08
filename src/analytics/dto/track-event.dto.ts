import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { EventType } from '../entities';

export class TrackEventDto {
  @IsNotEmpty()
  @IsEnum(EventType)
  eventType: EventType;

  @IsOptional()
  @IsObject()
  eventData?: Record<string, any>;

  @IsOptional()
  @IsString()
  gameType?: string;

  @IsOptional()
  @IsInt()
  sessionId?: number;
}
