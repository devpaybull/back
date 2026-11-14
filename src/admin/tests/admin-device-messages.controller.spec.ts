import { BadRequestException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { toFiat } from '../../common/utils/to-fiat';
import { DeviceMessage } from '../../device-messages/entities/device-message.entity';
import { DeviceMessageKind } from '../../device-messages/types/device-message-kind.enum';
import { DeviceMessageMatchStatus } from '../../device-messages/types/device-message-match-status.enum';
import { DeviceMessageSortField } from '../../device-messages/types/device-message-sort-field.enum';
import { DeviceMessageType } from '../../device-messages/types/device-message-type.enum';
import { UnknownSenders } from '../../device-messages/types/unknown-senders.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { AdminDeviceMessagesController } from '../controllers/admin-device-messages.controller';
import { ListDeviceMessagesQueryDto } from '../dto/list-device-messages-query.dto';

const TRADER = uuidOf(1);
const OTHER = uuidOf(2);
const DEAL = uuidOf(3);

const message = (overrides: Partial<DeviceMessage>): DeviceMessage =>
  ({
    id: 1,
    deviceId: 7,
    userId: TRADER,
    kind: DeviceMessageKind.Sms,
    sender: 'T-Bank',
    text: 'Пополнение на 1 500 ₽',
    receivedAt: new Date('2026-11-14T10:00:00Z'),
    createdAt: new Date('2026-11-14T10:00:01Z'),
    senderKnown: true,
    messageType: DeviceMessageType.Credit,
    templateId: 5,
    parsedAmount: toFiat('1500'),
    matchStatus: DeviceMessageMatchStatus.Matched,
    transactionId: DEAL,
    ...overrides,
  }) as DeviceMessage;

const query = {
  page: 1,
  limit: 20,
  sortBy: DeviceMessageSortField.CreatedAt,
  sortOrder: SortOrder.Desc,
  period: DayPeriod.AllTime,
} as ListDeviceMessagesQueryDto;

const build = () => {
  const rows = [
    message({}),
    message({
      id: 2,
      deviceId: 8,
      userId: OTHER,
      templateId: null,
      parsedAmount: null,
      messageType: DeviceMessageType.Unknown,
      matchStatus: DeviceMessageMatchStatus.NoTemplate,
      transactionId: null,
    }),
  ];
  const messages = {
    list: jest.fn(async (q: { page: number; limit: number }) =>
      toPage([rows, rows.length], q),
    ),
    countsOf: jest.fn(async () => ({
      all: 2,
      push: 0,
      sms: 2,
      credit: 1,
      statement: 0,
    })),
  };
  const directory = {
    findByIds: jest.fn(async () => [
      { id: TRADER, telegramUsername: 'ivan', email: null },
      { id: OTHER, telegramUsername: null, email: 'petr@example.com' },
    ]),
  };
  const devices = {
    findByIdsWithDeleted: jest.fn(async () => [
      { id: 7, name: 'Pixel 7' },
      { id: 8, name: 'Galaxy', deletedAt: new Date() },
    ]),
  };
  const templates = {
    findByIds: jest.fn(async () => [
      { id: 5, bank: { name: 'Т-Банк', currency: { isocode: 'RUB' } } },
    ]),
  };
  const transactions = {
    findByIds: jest.fn(async () => [
      {
        id: DEAL,
        status: TransactionStatus.Success,
        amountFiat: toFiat('1500'),
      },
    ]),
  };
  const config = { getOrThrow: jest.fn(() => 'Europe/Moscow') };
  const controller = new AdminDeviceMessagesController(
    messages as never,
    directory as never,
    devices as never,
    templates as never,
    transactions as never,
    config as never,
  );

  return { controller, messages, directory, devices, templates, transactions };
};

describe('AdminDeviceMessagesController', () => {
  it('is for admin and superadmin, and reads only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminDeviceMessagesController),
    ).toEqual([Role.Admin, Role.Superadmin]);

    for (const handler of ['list', 'counters'] as const) {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminDeviceMessagesController.prototype[handler],
        ),
      ).toBeUndefined();
    }
  });

  it('hands the filters over with traderUserId as the owner, and no owner without it', async () => {
    const { controller, messages } = build();

    await controller.list(query);
    await controller.list({
      ...query,
      traderUserId: TRADER,
      deviceName: 'pix',
      deviceId: 7,
      unknownSenders: UnknownSenders.Show,
      sortBy: DeviceMessageSortField.Sender,
    } as ListDeviceMessagesQueryDto);

    expect(messages.list.mock.calls[0][0]).toEqual(
      expect.objectContaining({ userId: undefined, showUnknownSenders: false }),
    );
    expect(messages.list.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        userId: TRADER,
        deviceName: 'pix',
        deviceId: 7,
        showUnknownSenders: true,
        sortBy: DeviceMessageSortField.Sender,
      }),
    );
  });

  it('refuses a period together with dates', async () => {
    const { controller } = build();

    expect(() =>
      controller.counters({
        period: DayPeriod.Today,
        createdFrom: '2026-11-01',
      }),
    ).toThrow(BadRequestException);
  });

  it('composes each row from one batched call per owner', async () => {
    const { controller, directory, devices, templates, transactions } = build();

    const page = await controller.list(query);

    expect(directory.findByIds).toHaveBeenCalledTimes(1);
    expect(directory.findByIds).toHaveBeenCalledWith([TRADER, OTHER]);
    expect(devices.findByIdsWithDeleted).toHaveBeenCalledWith([7, 8]);
    expect(templates.findByIds).toHaveBeenCalledWith([5]);
    expect(transactions.findByIds).toHaveBeenCalledWith([DEAL]);
    expect(page.meta.total).toBe(2);
    expect(page.items).toEqual([
      expect.objectContaining({
        id: 1,
        trader: { id: TRADER, login: 'ivan', telegramUsername: 'ivan' },
        device: { id: 7, name: 'Pixel 7' },
        sender: 'T-Bank',
        senderName: 'Т-Банк',
        currency: 'RUB',
        parsedAmount: '1500.00',
        matchStatus: DeviceMessageMatchStatus.Matched,
        transaction: {
          id: DEAL,
          status: TransactionStatus.Success,
          amountFiat: '1500.00',
        },
        template: { id: 5 },
      }),
      expect.objectContaining({
        id: 2,
        trader: {
          id: OTHER,
          login: 'petr@example.com',
          telegramUsername: null,
        },
        device: { id: 8, name: 'Galaxy' },
        senderName: null,
        currency: null,
        parsedAmount: null,
        matchStatus: DeviceMessageMatchStatus.NoTemplate,
        transaction: null,
        template: null,
      }),
    ]);
  });
});
