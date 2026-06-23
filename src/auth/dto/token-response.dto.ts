export class TokenResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    userId: number;
    username: string;
    nickname: string;
    level: number;
  };
}
