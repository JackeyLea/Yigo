import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

export interface CurrentUserData {
  userId: number;
  username: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserData => {
    const request = context.switchToHttp().getRequest();
    return request.user;
  },
);
