import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { TraderSettings } from './entities/trader-settings.entity';
import { TraderSettingsService } from './trader-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([TraderSettings]), AuditModule],
  providers: [TraderSettingsService],
  exports: [TraderSettingsService],
})
export class TraderSettingsModule {}
