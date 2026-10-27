import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { MerchantsModule } from '../merchants.module';
import { MerchantAttachmentsService } from '../services/merchant-attachments.service';
import { MerchantCurrenciesService } from '../services/merchant-currencies.service';
import { MerchantIpAddressesService } from '../services/merchant-ip-addresses.service';
import { MerchantSettingsService } from '../services/merchant-settings.service';
import { MerchantGroupsService } from '../services/merchant-groups.service';
import { MerchantMethodsService } from '../services/merchant-methods.service';
import { MerchantsService } from '../services/merchants.service';

describe('the merchants module graph', () => {
  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const dataSource = {
    transaction: jest.fn(),
    manager: {},
    options: {},
    entityMetadatas: [],
    getRepository: () => repository,
  };

  @Global()
  @Module({
    providers: [{ provide: getDataSourceToken(), useValue: dataSource }],
    exports: [getDataSourceToken()],
  })
  class FakeDataSourceModule {}

  it('resolves its services through the users, currencies and audit modules', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FakeDataSourceModule,
        MerchantsModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string) => (key === 'VICTORIA_LOGS_URL' ? '' : 60)),
      })
      .compile();

    expect(module.get(MerchantsService)).toBeInstanceOf(MerchantsService);
    expect(module.get(MerchantGroupsService)).toBeInstanceOf(
      MerchantGroupsService,
    );
    expect(module.get(MerchantMethodsService)).toBeInstanceOf(
      MerchantMethodsService,
    );
    expect(module.get(MerchantAttachmentsService)).toBeInstanceOf(
      MerchantAttachmentsService,
    );
    expect(module.get(MerchantSettingsService)).toBeInstanceOf(
      MerchantSettingsService,
    );
    expect(module.get(MerchantCurrenciesService)).toBeInstanceOf(
      MerchantCurrenciesService,
    );
    expect(module.get(MerchantIpAddressesService)).toBeInstanceOf(
      MerchantIpAddressesService,
    );
  });
});
