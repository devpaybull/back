import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { UsersModule } from '../users/users.module';
import { MerchantApiKey } from './entities/merchant-api-key.entity';
import { MerchantAttachmentMethod } from './entities/merchant-attachment-method.entity';
import { MerchantAttachment } from './entities/merchant-attachment.entity';
import { MerchantCurrency } from './entities/merchant-currency.entity';
import { MerchantGroup } from './entities/merchant-group.entity';
import { MerchantIpAddress } from './entities/merchant-ip-address.entity';
import { MerchantMethod } from './entities/merchant-method.entity';
import { MerchantSettings } from './entities/merchant-settings.entity';
import { Merchant } from './entities/merchant.entity';
import { MerchantAttachmentsService } from './services/merchant-attachments.service';
import { MerchantCurrenciesService } from './services/merchant-currencies.service';
import { MerchantGroupsService } from './services/merchant-groups.service';
import { MerchantIpAddressesService } from './services/merchant-ip-addresses.service';
import { MerchantMethodsService } from './services/merchant-methods.service';
import { MerchantSettingsService } from './services/merchant-settings.service';
import { MerchantsService } from './services/merchants.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Merchant,
      MerchantApiKey,
      MerchantGroup,
      MerchantMethod,
      MerchantAttachment,
      MerchantAttachmentMethod,
      MerchantSettings,
      MerchantCurrency,
      MerchantIpAddress,
    ]),
    AuditModule,
    CurrenciesModule,
    UsersModule,
  ],
  providers: [
    MerchantsService,
    MerchantGroupsService,
    MerchantMethodsService,
    MerchantAttachmentsService,
    MerchantSettingsService,
    MerchantCurrenciesService,
    MerchantIpAddressesService,
  ],
  exports: [
    MerchantsService,
    MerchantGroupsService,
    MerchantMethodsService,
    MerchantAttachmentsService,
    MerchantSettingsService,
    MerchantCurrenciesService,
    MerchantIpAddressesService,
  ],
})
export class MerchantsModule {}
