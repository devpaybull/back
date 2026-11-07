import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantsModule } from '../merchants/merchants.module';
import { MerchantCallback } from './entities/merchant-callback.entity';
import { MerchantCallbackSenderService } from './services/merchant-callback-sender.service';
import { MerchantCallbacksService } from './services/merchant-callbacks.service';
import { NodeCallbackHttpClient } from './services/node-callback-http-client.service';
import { CallbackHttpClient } from './types/callback-http-client';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantCallback]), MerchantsModule],
  providers: [
    MerchantCallbacksService,
    MerchantCallbackSenderService,
    { provide: CallbackHttpClient, useClass: NodeCallbackHttpClient },
  ],
  exports: [
    MerchantCallbacksService,
    MerchantCallbackSenderService,
    CallbackHttpClient,
  ],
})
export class MerchantCallbacksModule {}
