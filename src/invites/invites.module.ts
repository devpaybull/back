import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantsModule } from '../merchants/merchants.module';
import { UsersModule } from '../users/users.module';
import { Invite } from './entities/invite.entity';
import { InvitesService } from './invites.service';

@Module({
  imports: [TypeOrmModule.forFeature([Invite]), UsersModule, MerchantsModule],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
