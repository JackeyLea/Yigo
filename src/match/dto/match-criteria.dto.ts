import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

export class MatchCriteriaDto {
  @IsString()
  pluginId: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(1000)
  ratingRange?: number = 200;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(300)
  maxWaitTime?: number = 60;

  @IsOptional()
  @IsBoolean()
  allowAI?: boolean = true;

  @IsOptional()
  @IsString()
  aiDifficulty?: string = 'medium';

  @IsOptional()
  @IsString()
  mode?: string = 'normal';
}
