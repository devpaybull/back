import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Merchant } from './entities/merchant.entity';
import { MerchantApiKey } from './entities/merchant-api-key.entity';
import { MerchantsService } from './merchants.service';

@Module({
  imports: [TypeOrmModule.forFeature([Merchant, MerchantApiKey])],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
