import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { MerchantApiRequest } from './entities/merchant-api-request.entity';
import { MerchantRequestArchiveService } from './services/merchant-request-archive.service';
import { MerchantRequestsService } from './services/merchant-requests.service';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantApiRequest]), AuditModule],
  providers: [MerchantRequestsService, MerchantRequestArchiveService],
  exports: [MerchantRequestsService],
})
export class MerchantRequestsModule {}
