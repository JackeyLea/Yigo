import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminGuard, SuperAdminGuard } from './admin.guard';

@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminGuard,
    SuperAdminGuard,
    // Uncomment to enable global admin guard
    // {
    //   provide: APP_GUARD,
    //   useClass: AdminGuard,
    // },
  ],
  exports: [AdminService, AdminGuard, SuperAdminGuard],
})
export class AdminModule {}
