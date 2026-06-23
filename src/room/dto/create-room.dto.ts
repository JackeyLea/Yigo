import {
  IsString,
  IsObject,
  IsOptional,
  MaxLength,
  IsInt,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';

export class CreateRoomDto {
  @IsString()
  pluginId: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, any>;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  password?: string;

  @IsInt()
  @Min(2)
  @Max(9)
  maxPlayers: number;

  @IsBoolean()
  @IsOptional()
  allowSpectator?: boolean = true;

  @IsString()
  @IsOptional()
  mode?: string = 'normal';
}
