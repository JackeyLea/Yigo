import { IsNotEmpty, IsInt, IsString } from 'class-validator';

export class ApproveApplicationDto {
  @IsNotEmpty()
  @IsString()
  clubId: string;

  @IsNotEmpty()
  @IsInt()
  applicantId: number;
}
