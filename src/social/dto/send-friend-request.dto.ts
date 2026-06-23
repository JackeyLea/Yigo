import { IsNotEmpty, IsNumberString } from 'class-validator';

export class SendFriendRequestDto {
  @IsNotEmpty()
  @IsNumberString()
  toUserId: string;
}
