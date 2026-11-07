import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { MerchantApiRequest } from './entities/merchant-api-request.entity';
import { MerchantRequestArchiveService } from './services/merchant-request-archive.service';
import { MerchantRequestHistoryService } from './services/merchant-request-history.service';
import { MerchantRequestsService } from './services/merchant-requests.service';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantApiRequest]), AuditModule],
  providers: [
    MerchantRequestsService,
    MerchantRequestArchiveService,
    MerchantRequestHistoryService,
  ],
  exports: [MerchantRequestsService, MerchantRequestHistoryService],
})
export class MerchantRequestsModule {}
