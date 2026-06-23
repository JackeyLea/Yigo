import { IsString, IsOptional, IsInt } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  roomId: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsInt()
  @IsOptional()
  seatIndex?: number;
}
