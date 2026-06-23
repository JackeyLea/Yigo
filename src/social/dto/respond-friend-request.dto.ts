import { IsNotEmpty, IsNumberString } from 'class-validator';

export class RespondFriendRequestDto {
  @IsNotEmpty()
  @IsNumberString()
  requestId: string;
}
