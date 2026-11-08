import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankruptcyService } from './bankruptcy.service';
import { BankruptcyController } from './bankruptcy.controller';
import { UserBalance } from '../common/entities';

@Module({
  imports: [TypeOrmModule.forFeature([UserBalance])],
  controllers: [BankruptcyController],
  providers: [BankruptcyService],
  exports: [BankruptcyService],
})
export class BankruptcyModule {}
