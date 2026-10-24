import { NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { Page } from '../../common/types/page';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';
import { AdminCounterpartiesController } from '../controllers/admin-counterparties.controller';

describe('AdminCounterpartiesController', () => {
  const counterparty = (): Counterparty =>
    ({
      id: 1,
      merchantId: 'm1',
      externalId: 'ext-1',
      name: null,
      contact: null,
      payload: null,
      createdAt: new Date(),
    }) as Counterparty;

  let counterparties: { list: jest.Mock; findById: jest.Mock };
  let controller: AdminCounterpartiesController;

  beforeEach(() => {
    counterparties = { list: jest.fn(), findById: jest.fn() };
    controller = new AdminCounterpartiesController(counterparties as never);
  });

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminCounterpartiesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks neither read as a write', () => {
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.list),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.findOne),
    ).toBeUndefined();
  });

  it('maps the page to counterparty DTOs', async () => {
    counterparties.list.mockResolvedValue(
      new Page([counterparty()], { total: 1, page: 1, limit: 20, pages: 1 }),
    );

    const page = await controller.list({} as never);

    expect(page.items[0].externalId).toBe('ext-1');
  });

  it('404 when the counterparty is unknown', async () => {
    counterparties.findById.mockResolvedValue(null);

    await expect(controller.findOne(1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
