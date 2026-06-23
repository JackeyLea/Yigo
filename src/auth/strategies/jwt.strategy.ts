import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as fs from 'fs';
import * as path from 'path';
import { UserService } from '../../user/user.service';

interface JwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly userService: UserService) {
    const keysDir = process.env.JWT_KEYS_DIR || './keys';
    const publicKey = fs.readFileSync(
      path.join(keysDir, 'jwt-public.pem'),
      'utf8',
    );

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: publicKey,
      algorithms: ['RS256'],
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userService.findById(Number(payload.sub));
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      userId: Number(payload.sub),
      username: payload.username,
    };
  }
}
