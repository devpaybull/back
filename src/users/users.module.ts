import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { TraderSettingsModule } from '../trader-settings/trader-settings.module';
import { EmailVerification } from './entities/email-verification.entity';
import { UserBackupCode } from './entities/user-backup-code.entity';
import { User } from './entities/user.entity';
import { EmailVerificationService } from './services/email-verification.service';
import { UserAdministrationService } from './services/user-administration.service';
import { UserCredentialsService } from './services/user-credentials.service';
import { UserDirectoryService } from './services/user-directory.service';
import { UserEnrolmentService } from './services/user-enrolment.service';
import { UserProfileService } from './services/user-profile.service';
import { UsersController } from './users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserBackupCode, EmailVerification]),
    MailModule,
    TraderSettingsModule,
  ],
  controllers: [UsersController],
  providers: [
    UserDirectoryService,
    UserCredentialsService,
    UserEnrolmentService,
    UserAdministrationService,
    UserProfileService,
    EmailVerificationService,
  ],
  exports: [
    UserDirectoryService,
    UserCredentialsService,
    UserEnrolmentService,
    UserAdministrationService,
  ],
})
export class UsersModule {}
