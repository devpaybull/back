import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { toPage } from '../../common/types/page';
import { MobileOperator } from '../../mobile-operators/entities/mobile-operator.entity';
import { MobileOperatorsService } from '../../mobile-operators/mobile-operators.service';
import { AdminMobileOperatorsController } from '../controllers/admin-mobile-operators.controller';
import { ListMobileOperatorsQueryDto } from '../dto/list-mobile-operators-query.dto';

describe('AdminMobileOperatorsController', () => {
  const country = { id: 1, name: 'Russia' };

  const mts = (overrides: Partial<MobileOperator> = {}): MobileOperator =>
    ({
      id: 1,
      code: 'mts',
      name: 'MTS',
      countryId: 1,
      country,
      active: true,
      createdAt: new Date('2026-11-04T00:00:00.000Z'),
      ...overrides,
    }) as MobileOperator;

  const operators = {
    create: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };

  let controller: AdminMobileOperatorsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    operators.create.mockResolvedValue(mts());
    operators.list.mockResolvedValue(
      toPage([[mts()], 1], { page: 1, limit: 20 }),
    );
    operators.findById.mockResolvedValue(mts());
    operators.update.mockResolvedValue(mts({ active: false }));

    const module = await Test.createTestingModule({
      controllers: [AdminMobileOperatorsController],
      providers: [{ provide: MobileOperatorsService, useValue: operators }],
    }).compile();

    controller = module.get(AdminMobileOperatorsController);
  });

  it('is restricted to admins and superadmins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminMobileOperatorsController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it.each(['create', 'update'])('marks %s as a write', (handler) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminMobileOperatorsController.prototype[handler],
      ),
    ).toBe(true);
  });

  it.each(['list', 'findOne'])(
    'leaves %s unmarked, so a suspended admin still reads',
    (handler) => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminMobileOperatorsController.prototype[handler],
        ),
      ).toBeUndefined();
    },
  );

  it('describes an operator with its country resolved', async () => {
    await expect(controller.findOne(1)).resolves.toEqual({
      id: 1,
      code: 'mts',
      name: 'MTS',
      countryId: 1,
      country,
      active: true,
      createdAt: new Date('2026-11-04T00:00:00.000Z'),
    });
  });

  it('answers 404 for an operator nobody holds', async () => {
    operators.findById.mockResolvedValue(null);

    await expect(controller.findOne(404)).rejects.toThrow(NotFoundException);
  });

  it('hands the whole query through and keeps the meta the service produced', async () => {
    const listed = await controller.list(
      plainToInstance(ListMobileOperatorsQueryDto, { active: 'false' }),
    );

    expect(operators.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, active: false }),
    );
    expect(listed.meta).toEqual({ total: 1, page: 1, limit: 20, pages: 1 });
    expect(listed.items[0]).toMatchObject({ code: 'mts' });
  });

  it('deactivates an operator through the patch', async () => {
    await expect(
      controller.update(1, { active: false }),
    ).resolves.toMatchObject({ active: false });
    expect(operators.update).toHaveBeenCalledWith(1, { active: false });
  });

  it('refuses an empty patch rather than saving nothing', async () => {
    await expect(controller.update(1, {})).rejects.toThrow(BadRequestException);
    expect(operators.update).not.toHaveBeenCalled();
  });
});
