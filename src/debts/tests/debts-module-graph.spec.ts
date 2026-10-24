import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DebtsModule } from '../debts.module';
import { DebtAutoWriteOffService } from '../services/debt-auto-write-off.service';
import { DebtsService } from '../services/debts.service';

describe('the debts module graph', () => {
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

  const compile = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FakeDataSourceModule,
        DebtsModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string) => (key === 'VICTORIA_LOGS_URL' ? '' : 60)),
      })
      .compile();

  it('resolves every provider it wires and exposes the debts service', async () => {
    const module = await compile();

    expect(module.get(DebtsService)).toBeInstanceOf(DebtsService);
    expect(module.get(DebtAutoWriteOffService)).toBeInstanceOf(
      DebtAutoWriteOffService,
    );
  });
});
