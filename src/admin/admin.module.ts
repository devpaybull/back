import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitesModule } from '../invites/invites.module';
import { UsersModule } from '../users/users.module';
import { AdminInvitesController } from './controllers/admin-invites.controller';
import { AdminUsersController } from './controllers/admin-users.controller';

@Module({
  imports: [AuthModule, InvitesModule, UsersModule],
  controllers: [AdminInvitesController, AdminUsersController],
})
export class AdminModule {}
