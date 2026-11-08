import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { toFiat } from '../../common/utils/to-fiat';
import { BankMessageType } from '../../message-templates/types/bank-message-type.enum';
import { AdminMessageTemplatesController } from '../controllers/admin-message-templates.controller';

const template = {
  id: 1,
  bankId: 5,
  bank: { id: 5, name: 'Т-банк' },
  sender: '900',
  messageType: BankMessageType.Credit,
  pattern: '(?<amount>\\d+)',
  active: true,
  createdAt: new Date('2026-11-08T00:00:00Z'),
};

const build = (found: object | null = template) => {
  const templates = {
    test: jest.fn(() => ({ matched: true, amount: toFiat('1500.5') })),
    findById: jest.fn(async () => found),
    update: jest.fn(async () => template),
  };

  return {
    templates,
    controller: new AdminMessageTemplatesController(templates as never),
  };
};

describe('AdminMessageTemplatesController', () => {
  it('is for admin and superadmin, and every write is marked', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminMessageTemplatesController),
    ).toEqual([Role.Admin, Role.Superadmin]);

    for (const handler of ['create', 'update', 'remove'] as const) {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminMessageTemplatesController.prototype[handler],
        ),
      ).toBe(true);
    }
  });

  it('answers a test with the amount as a fiat string', () => {
    const { controller, templates } = build();

    expect(controller.test({ pattern: 'p', text: 't' })).toEqual({
      matched: true,
      amount: '1500.50',
    });
    expect(templates.test).toHaveBeenCalledWith('p', 't');
  });

  it('refuses an empty patch and answers an unknown id with a 404', async () => {
    const { controller } = build(null);

    await expect(controller.update(1, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.findOne(1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('shows the bank by id and name', async () => {
    await expect(build().controller.findOne(1)).resolves.toEqual(
      expect.objectContaining({
        bank: { id: 5, name: 'Т-банк' },
        sender: '900',
      }),
    );
  });
});
