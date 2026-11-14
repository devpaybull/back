import { NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toFiat } from '../../common/utils/to-fiat';
import { DeviceMessage } from '../../device-messages/entities/device-message.entity';
import { DeviceMessageKind } from '../../device-messages/types/device-message-kind.enum';
import { DeviceMessageMatchStatus } from '../../device-messages/types/device-message-match-status.enum';
import { DeviceMessageSortField } from '../../device-messages/types/device-message-sort-field.enum';
import { DeviceMessageType } from '../../device-messages/types/device-message-type.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { TraderMessagesController } from '../controllers/trader-messages.controller';
import { ListTraderMessagesQueryDto } from '../dto/list-trader-messages-query.dto';
import { UnknownSenders } from '../../device-messages/types/unknown-senders.enum';

const trader: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'trader',
  role: Role.Trader,
  status: UserStatus.Active,
};

const message = {
  id: 5,
  deviceId: 7,
  kind: DeviceMessageKind.Sms,
  sender: '900',
  senderKnown: true,
  text: 'Зачисление 1000 р',
  receivedAt: new Date('2026-11-08T09:00:00Z'),
  createdAt: new Date('2026-11-08T09:00:01Z'),
  messageType: DeviceMessageType.Credit,
  templateId: 3,
  parsedAmount: toFiat('1000'),
  matchStatus: DeviceMessageMatchStatus.Matched,
  transactionId: uuidOf(2),
} as DeviceMessage;

const query = {
  page: 1,
  limit: 20,
  sortBy: DeviceMessageSortField.CreatedAt,
  sortOrder: SortOrder.Desc,
  period: DayPeriod.AllTime,
} as ListTraderMessagesQueryDto;

const build = (ownsDevice = true) => {
  const messages = {
    list: jest.fn(
      async () =>
        new Page([message], { total: 1, page: 1, limit: 20, pages: 1 }),
    ),
    countsOf: jest.fn(async () => ({
      all: 1,
      push: 0,
      sms: 1,
      credit: 1,
      statement: 0,
    })),
  };
  const devices = {
    findOwn: jest.fn(async () => (ownsDevice ? { id: 7 } : null)),
  };
  const config = { getOrThrow: jest.fn(() => 'Europe/Moscow') };
  const controller = new TraderMessagesController(
    messages as never,
    devices as never,
    config as never,
  );

  return { controller, messages, devices };
};

describe('TraderMessagesController', () => {
  it('is for traders only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, TraderMessagesController),
    ).toEqual([Role.Trader]);
  });

  it('lists the caller’s own messages, unknown senders hidden unless asked, money as a string', async () => {
    const { controller, messages } = build();

    const page = await controller.list(trader, query);

    expect(messages.list).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: trader.id,
        showUnknownSenders: false,
        page: 1,
      }),
    );
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        amount: '1000.00',
        matchStatus: 'matched',
        transactionId: uuidOf(2),
      }),
    );

    await controller.list(trader, {
      ...query,
      unknownSenders: UnknownSenders.Show,
    } as ListTraderMessagesQueryDto);

    expect(messages.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: trader.id, showUnknownSenders: true }),
    );
  });

  it('defaults the period to today in BUSINESS_TIMEZONE', async () => {
    const { controller, messages } = build();

    await controller.counters(trader, {});

    const [filter] = messages.countsOf.mock.calls[0] as unknown as [
      { userId: string; createdFrom: Date; createdTo: Date },
    ];

    expect(filter.userId).toBe(trader.id);

    expect(filter.createdTo.getTime() - filter.createdFrom.getTime()).toBe(
      24 * 60 * 60 * 1000 - 1,
    );
  });

  it('answers a device of somebody else with a 404 and lists the own one by its id', async () => {
    await expect(
      build(false).controller.ofDevice(trader, 7, query),
    ).rejects.toBeInstanceOf(NotFoundException);

    const { controller, messages, devices } = build();

    await controller.ofDevice(trader, 7, {
      ...query,
      deviceId: 99,
    } as ListTraderMessagesQueryDto);

    expect(devices.findOwn).toHaveBeenCalledWith(7, trader.id);
    expect(messages.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: trader.id, deviceId: 7 }),
    );
  });

  it('always scopes the list and the counters to the caller, whatever the query carries', async () => {
    const { controller, messages } = build();
    const smuggled = { ...query, userId: uuidOf(9) } as never;

    await controller.list(trader, smuggled);
    await controller.counters(trader, smuggled);

    expect(messages.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: trader.id }),
    );
    expect(messages.countsOf).toHaveBeenCalledWith(
      expect.objectContaining({ userId: trader.id }),
    );
  });
});
