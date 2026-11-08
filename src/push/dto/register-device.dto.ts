import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Platform } from '../entities';

export class RegisterDeviceDto {
  @IsNotEmpty()
  @IsString()
  deviceToken: string;

  @IsNotEmpty()
  @IsEnum(Platform)
  platform: Platform;

  @IsOptional()
  @IsString()
  deviceModel?: string;

  @IsOptional()
  @IsString()
  osVersion?: string;

  @IsOptional()
  @IsString()
  appVersion?: string;
}
