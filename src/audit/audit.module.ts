import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditInstallation } from './entities/audit-installation.entity';
import { AuditLog } from './entities/audit-log.entity';
import { HttpAuditMiddleware } from './middleware/http-audit.middleware';
import { AuditInstallationService } from './services/audit-installation.service';
import { AuditArchiveService } from './services/audit-archive.service';
import { AuditService } from './services/audit.service';
import { VictoriaLogsService } from './services/victoria-logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, AuditInstallation])],
  providers: [
    AuditService,
    AuditInstallationService,
    VictoriaLogsService,
    AuditArchiveService,
  ],
  exports: [AuditService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(HttpAuditMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
