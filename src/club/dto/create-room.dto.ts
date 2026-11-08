import { IsNotEmpty, IsInt, IsOptional, IsString } from 'class-validator';

export class RoomConfigDto {
  @IsOptional()
  @IsInt()
  timeControl?: number;

  @IsOptional()
  @IsInt()
  rated?: number;

  @IsOptional()
  @IsString()
  color?: string;

  [key: string]: any;
}

export class CreateRoomDto {
  @IsNotEmpty()
  @IsString()
  clubId: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  gameType: string;

  @IsOptional()
  @IsInt()
  maxPlayers?: number;

  @IsOptional()
  config?: RoomConfigDto;
}
