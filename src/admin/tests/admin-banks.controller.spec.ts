import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { BanksService } from '../../banks/banks.service';
import { Bank } from '../../banks/entities/bank.entity';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { toPage } from '../../common/types/page';
import { AdminBanksController } from '../controllers/admin-banks.controller';
import { ListBanksQueryDto } from '../dto/list-banks-query.dto';

describe('AdminBanksController', () => {
  const country = { id: 1, name: 'Kazakhstan' };
  const tenge = {
    id: 1,
    name: 'Kazakhstani tenge',
    isocode: 'KZT',
    countryId: 1,
    country,
  };

  const kaspi = (overrides: Partial<Bank> = {}): Bank =>
    ({
      id: 1,
      bankId: 'kaspi',
      name: 'Kaspi Bank',
      code: 'KASPIKZKA',
      countryId: 1,
      country,
      transactionTypes: [TransactionType.Card, TransactionType.Sbp],
      currencyId: 1,
      currency: tenge,
      crossBorderCurrencyId: null,
      crossBorderCurrency: null,
      active: true,
      automatic: false,
      createdAt: new Date('2026-07-30T00:00:00.000Z'),
      ...overrides,
    }) as Bank;

  const banks = {
    create: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };

  const query = (overrides: Record<string, unknown> = {}): ListBanksQueryDto =>
    plainToInstance(ListBanksQueryDto, overrides);

  let controller: AdminBanksController;

  beforeEach(async () => {
    jest.clearAllMocks();
    banks.create.mockResolvedValue(kaspi());
    banks.list.mockResolvedValue(
      toPage([[kaspi()], 1], { page: 1, limit: 20 }),
    );
    banks.findById.mockResolvedValue(kaspi());
    banks.update.mockResolvedValue(kaspi({ active: false }));

    const module = await Test.createTestingModule({
      controllers: [AdminBanksController],
      providers: [{ provide: BanksService, useValue: banks }],
    }).compile();

    controller = module.get(AdminBanksController);
  });

  it('is restricted to admins and superadmins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminBanksController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it.each(['create', 'update'])('marks %s as a write', (handler) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminBanksController.prototype[handler],
      ),
    ).toBe(true);
  });

  it.each(['list', 'findOne'])(
    'leaves %s unmarked, so a suspended admin still reads',
    (handler) => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminBanksController.prototype[handler],
        ),
      ).toBeUndefined();
    },
  );

  it('describes a bank with both of its currencies resolved', async () => {
    banks.findById.mockResolvedValue(
      kaspi({ crossBorderCurrencyId: 2, crossBorderCurrency: tenge as never }),
    );

    await expect(controller.findOne(1)).resolves.toMatchObject({
      bankId: 'kaspi',
      transactionTypes: [TransactionType.Card, TransactionType.Sbp],
      currency: { isocode: 'KZT', country },
      crossBorderCurrencyId: 2,
      crossBorderCurrency: { isocode: 'KZT' },
    });
  });

  it('reports an absent cross-border currency as null', async () => {
    await expect(controller.findOne(1)).resolves.toMatchObject({
      crossBorderCurrencyId: null,
      crossBorderCurrency: null,
    });
  });

  it('answers 404 for a bank nobody holds', async () => {
    banks.findById.mockResolvedValue(null);

    await expect(controller.findOne(404)).rejects.toThrow(NotFoundException);
  });

  it('hands the whole query through and keeps the meta the service produced', async () => {
    const listed = await controller.list(query({ active: 'true' }));

    expect(banks.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, active: true }),
    );
    expect(listed.meta).toEqual({ total: 1, page: 1, limit: 20, pages: 1 });
    expect(listed.items[0]).toMatchObject({ bankId: 'kaspi' });
  });

  it('deactivates a bank through the patch', async () => {
    await expect(
      controller.update(1, { active: false }),
    ).resolves.toMatchObject({ active: false });
    expect(banks.update).toHaveBeenCalledWith(1, { active: false });
  });

  it('refuses an empty patch rather than saving nothing', async () => {
    await expect(controller.update(1, {})).rejects.toThrow(BadRequestException);
    expect(banks.update).not.toHaveBeenCalled();
  });
});
