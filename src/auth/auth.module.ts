import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvitesModule } from '../invites/invites.module';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { EnrolmentController } from './controllers/enrolment.controller';
import { PasswordController } from './controllers/password.controller';
import { SessionController } from './controllers/session.controller';
import { PasswordReset } from './entities/password-reset.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { EnrolmentService } from './services/enrolment.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, PasswordReset]),
    UsersModule,
    InvitesModule,
    MailModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: config.get<number>('JWT_ACCESS_TTL_SECONDS'),
        },
      }),
    }),
  ],
  controllers: [EnrolmentController, SessionController, PasswordController],
  providers: [SessionService, EnrolmentService, PasswordService],
  exports: [SessionService],
})
export class AuthModule {}
