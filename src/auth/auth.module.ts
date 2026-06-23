import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { UserModule } from '../user/user.module';
import { User } from '../common/entities/user.entity';
import { Wallet } from '../common/entities/wallet.entity';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => {
        const keysDir = process.env.JWT_KEYS_DIR || './keys';
        const privateKey = fs.readFileSync(
          path.join(keysDir, 'jwt-private.pem'),
          'utf8',
        );
        const publicKey = fs.readFileSync(
          path.join(keysDir, 'jwt-public.pem'),
          'utf8',
        );
        return {
          privateKey,
          publicKey,
          signOptions: {
            algorithm: 'RS256',
            expiresIn: process.env.JWT_EXPIRATION || '1h',
          },
          verifyOptions: {
            algorithms: ['RS256'],
          },
        };
      },
    }),
    TypeOrmModule.forFeature([User, Wallet]),
    forwardRef(() => UserModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
