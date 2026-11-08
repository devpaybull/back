import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { NotificationSetting } from './entities/notification-setting.entity';
import { TraderSettings } from './entities/trader-settings.entity';
import { TraderSettingsService } from './trader-settings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TraderSettings, NotificationSetting]),
    AuditModule,
  ],
  providers: [TraderSettingsService],
  exports: [TraderSettingsService],
})
export class TraderSettingsModule {}
