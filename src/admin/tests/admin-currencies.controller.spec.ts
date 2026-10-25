import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrenciesService } from '../../currencies/currencies.service';
import { Currency } from '../../currencies/entities/currency.entity';
import { AdminCurrenciesController } from '../controllers/admin-currencies.controller';

describe('AdminCurrenciesController', () => {
  const tenge = (overrides: Partial<Currency> = {}): Currency =>
    ({
      id: 1,
      name: 'Kazakhstani tenge',
      isocode: 'KZT',
      countryId: 1,
      country: { id: 1, name: 'Kazakhstan' },
      ...overrides,
    }) as Currency;

  const currencies = {
    create: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };

  let controller: AdminCurrenciesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    currencies.create.mockResolvedValue(tenge());
    currencies.list.mockResolvedValue([tenge()]);
    currencies.findById.mockResolvedValue(tenge());
    currencies.update.mockResolvedValue(tenge());

    const module = await Test.createTestingModule({
      controllers: [AdminCurrenciesController],
      providers: [{ provide: CurrenciesService, useValue: currencies }],
    }).compile();

    controller = module.get(AdminCurrenciesController);
  });

  it('is restricted to admins and superadmins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminCurrenciesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it.each(['create', 'update'])('marks %s as a write', (handler) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminCurrenciesController.prototype[handler],
      ),
    ).toBe(true);
  });

  it.each(['list', 'findOne'])(
    'leaves %s unmarked, so a suspended admin still reads',
    (handler) => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminCurrenciesController.prototype[handler],
        ),
      ).toBeUndefined();
    },
  );

  it('carries the country of a currency into the response', async () => {
    await expect(controller.findOne(1)).resolves.toEqual({
      id: 1,
      name: 'Kazakhstani tenge',
      isocode: 'KZT',
      countryId: 1,
      country: { id: 1, name: 'Kazakhstan' },
    });
  });

  it('reports a country that was not loaded as null rather than inventing one', async () => {
    currencies.findById.mockResolvedValue(tenge({ country: undefined }));

    await expect(controller.findOne(1)).resolves.toMatchObject({
      country: null,
      countryId: 1,
    });
  });

  it('answers 404 for a currency nobody holds', async () => {
    currencies.findById.mockResolvedValue(null);

    await expect(controller.findOne(404)).rejects.toThrow(NotFoundException);
  });

  it('refuses an empty patch rather than saving nothing', async () => {
    await expect(controller.update(1, {})).rejects.toThrow(BadRequestException);
    expect(currencies.update).not.toHaveBeenCalled();
  });
});
