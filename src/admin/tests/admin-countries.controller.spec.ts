import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { CountriesService } from '../../countries/countries.service';
import { Country } from '../../countries/entities/country.entity';
import { AdminCountriesController } from '../controllers/admin-countries.controller';

describe('AdminCountriesController', () => {
  const kazakhstan = { id: 1, name: 'Kazakhstan' } as Country;

  const countries = {
    create: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };

  let controller: AdminCountriesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    countries.create.mockResolvedValue(kazakhstan);
    countries.list.mockResolvedValue([kazakhstan]);
    countries.findById.mockResolvedValue(kazakhstan);
    countries.update.mockResolvedValue(kazakhstan);

    const module = await Test.createTestingModule({
      controllers: [AdminCountriesController],
      providers: [{ provide: CountriesService, useValue: countries }],
    }).compile();

    controller = module.get(AdminCountriesController);
  });

  it('is restricted to admins and superadmins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminCountriesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it.each([
    ['create', true],
    ['update', true],
  ])('marks %s as a write', (handler, marked) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminCountriesController.prototype[handler],
      ),
    ).toBe(marked);
  });

  it.each(['list', 'findOne'])(
    'leaves %s unmarked, so a suspended admin still reads',
    (handler) => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminCountriesController.prototype[handler],
        ),
      ).toBeUndefined();
    },
  );

  it('creates a country', async () => {
    await expect(controller.create({ name: 'Kazakhstan' })).resolves.toEqual({
      id: 1,
      name: 'Kazakhstan',
    });
    expect(countries.create).toHaveBeenCalledWith({ name: 'Kazakhstan' });
  });

  it('lists countries as a plain array, not a page', async () => {
    await expect(controller.list()).resolves.toEqual([
      { id: 1, name: 'Kazakhstan' },
    ]);
  });

  it('answers 404 for a country nobody holds', async () => {
    countries.findById.mockResolvedValue(null);

    await expect(controller.findOne(404)).rejects.toThrow(NotFoundException);
  });

  it('refuses an empty patch rather than saving nothing', async () => {
    await expect(controller.update(1, {})).rejects.toThrow(BadRequestException);
    expect(countries.update).not.toHaveBeenCalled();
  });
});
