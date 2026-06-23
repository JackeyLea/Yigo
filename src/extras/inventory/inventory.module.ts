import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryItem, ItemDefinition, ItemTransaction } from './inventory.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItem, ItemDefinition, ItemTransaction]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
