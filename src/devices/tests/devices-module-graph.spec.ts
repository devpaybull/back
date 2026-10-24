import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { Bank } from '../../banks/entities/bank.entity';
import { Country } from '../../countries/entities/country.entity';
import { Currency } from '../../currencies/entities/currency.entity';
import { BankDetailsController } from '../../bank-details/bank-details.controller';
import { DevicesController } from '../devices.controller';
import { DevicesModule } from '../devices.module';
import { DevicesService } from '../devices.service';
import { Device } from '../entities/device.entity';

describe('the devices ↔ bank-details module graph', () => {
  const repository = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    merge: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };

  const compile = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        DevicesModule,
      ],
    })
      .overrideProvider(getRepositoryToken(Device))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(BankDetails))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(Bank))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(Country))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(Currency))
      .useValue(repository)
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string) =>
          key === 'VICTORIA_LOGS_URL' ? '' : 5000,
        ),
      })
      .compile();

  it('resolves despite the cycle the two forwardRefs describe', async () => {
    await expect(compile()).resolves.toBeDefined();
  });

  it('gives the devices controller the bank-details service it deletes through', async () => {
    const module = await compile();

    expect(module.get(DevicesController)).toBeInstanceOf(DevicesController);
    expect(module.get(BankDetailsService)).toBeInstanceOf(BankDetailsService);
  });

  it('gives the bank-details controller its own service back', async () => {
    const module = await compile();

    expect(module.get(BankDetailsController, { strict: false })).toBeInstanceOf(
      BankDetailsController,
    );
    expect(module.get(DevicesService)).toBeInstanceOf(DevicesService);
  });
});
