import { ILike, LessThanOrEqual, MoreThanOrEqual, And } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { toFiat } from '../../common/utils/to-fiat';
import { Device } from '../../devices/entities/device.entity';
import { BankMessageTemplate } from '../../message-templates/entities/bank-message-template.entity';
import { BankMessageType } from '../../message-templates/types/bank-message-type.enum';
import { RecognisedMessage } from '../../message-templates/types/recognised-message';
import { DeviceMatchOutcome } from '../../transactions/types/device-match-outcome.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { DeviceMessage } from '../entities/device-message.entity';
import { DeviceMessagesService } from '../services/device-messages.service';
import { DeviceMessageKind } from '../types/device-message-kind.enum';
import { DeviceMessageMatchStatus } from '../types/device-message-match-status.enum';
import { DeviceMessageSortField } from '../types/device-message-sort-field.enum';
import { DeviceMessageType } from '../types/device-message-type.enum';

const OWNER = uuidOf(1);
const DEAL = uuidOf(2);
const REQUISITE = uuidOf(3);
const device = { id: 7, userId: OWNER } as Device;
const input = {
  externalId: 'sms-1',
  kind: DeviceMessageKind.Sms,
  sender: '900',
  text: 'Зачисление 1000 р',
  receivedAt: new Date('2026-11-08T10:00:00Z'),
};

const credit = { id: 3, bankId: 5, messageType: BankMessageType.Credit };
const recognisedCredit: RecognisedMessage = {
  senderKnown: true,
  template: credit as BankMessageTemplate,
  amount: toFiat('1000'),
};

const build = ({
  stored = null as DeviceMessage | null,
  recognised = recognisedCredit,
  ownerStatus = UserStatus.Active,
  insertedId = 11 as number | null,
  outcome = {
    outcome: DeviceMatchOutcome.Matched,
    transactionId: DEAL as string | null,
  },
} = {}) => {
  const insert = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn(async () => ({
      raw: insertedId === null ? [] : [{ id: insertedId }],
    })),
  };
  const manager = {
    createQueryBuilder: jest.fn(() => insert),
    update: jest.fn(async () => ({})),
    findOneOrFail: jest.fn(async () => ({ id: insertedId ?? 99 })),
  };
  const dataSource = {
    transaction: jest.fn((work: (m: unknown) => unknown) => work(manager)),
  };
  const messages = {
    findOne: jest.fn(async () => stored),
    findAndCount: jest.fn<
      Promise<[DeviceMessage[], number]>,
      [{ where: unknown }]
    >(async () => [[], 0]),
    count: jest.fn<Promise<number>, [{ where: unknown }]>(async () => 3),
  };
  const templates = { recognise: jest.fn(async () => recognised) };
  const users = { findById: jest.fn(async () => ({ status: ownerStatus })) };
  const requisites = {
    requisitesOfDeviceWithin: jest.fn(async () => [
      { id: REQUISITE, bankId: 5 },
    ]),
  };
  const dealActions = {
    confirmByDeviceWithin: jest.fn(async () => outcome),
  };
  const service = new DeviceMessagesService(
    dataSource as never,
    messages as never,
    templates as never,
    users as never,
    requisites as never,
    dealActions as never,
  );

  return {
    service,
    insert,
    manager,
    messages,
    templates,
    requisites,
    dealActions,
    dataSource,
  };
};

const insertedValues = (insert: { values: jest.Mock }) =>
  insert.values.mock.calls[0][0] as Record<string, unknown>;

describe('DeviceMessagesService', () => {
  describe('receive', () => {
    it('answers a repeat of (device, externalId) with the stored row and reads nothing else', async () => {
      const stored = { id: 4 } as DeviceMessage;
      const { service, templates, dataSource } = build({ stored });

      await expect(service.receive(device, input)).resolves.toBe(stored);
      expect(templates.recognise).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('stores the message for the device’s owner and confirms a credit through the deal actions in the same transaction', async () => {
      const { service, insert, manager, requisites, dealActions } = build();

      await service.receive(device, input);

      expect(insertedValues(insert)).toEqual({
        deviceId: 7,
        userId: OWNER,
        externalId: 'sms-1',
        kind: DeviceMessageKind.Sms,
        sender: '900',
        text: 'Зачисление 1000 р',
        receivedAt: input.receivedAt,
        senderKnown: true,
        messageType: DeviceMessageType.Credit,
        templateId: 3,
        parsedAmount: recognisedCredit.amount,
        matchStatus: DeviceMessageMatchStatus.NoCandidate,
        transactionId: null,
      });
      expect(insert.orIgnore).toHaveBeenCalled();
      expect(requisites.requisitesOfDeviceWithin).toHaveBeenCalledWith(
        manager,
        7,
        OWNER,
      );
      expect(dealActions.confirmByDeviceWithin).toHaveBeenCalledWith(manager, {
        traderUserId: OWNER,
        deviceId: 7,
        messageId: 11,
        bankId: 5,
        amountFiat: recognisedCredit.amount,
        requisites: [{ id: REQUISITE, bankId: 5 }],
      });
      expect(manager.update).toHaveBeenCalledWith(
        DeviceMessage,
        { id: 11 },
        { matchStatus: DeviceMessageMatchStatus.Matched, transactionId: DEAL },
      );
    });

    it.each([
      [DeviceMatchOutcome.NoCandidate, DeviceMessageMatchStatus.NoCandidate],
      [DeviceMatchOutcome.Ambiguous, DeviceMessageMatchStatus.Ambiguous],
      [DeviceMatchOutcome.BankMismatch, DeviceMessageMatchStatus.BankMismatch],
    ])('records %s without a deal', async (outcome, matchStatus) => {
      const { service, manager } = build({
        outcome: { outcome, transactionId: null },
      });

      await service.receive(device, input);

      expect(manager.update).toHaveBeenCalledWith(
        DeviceMessage,
        { id: 11 },
        { matchStatus, transactionId: null },
      );
    });

    it('stores a text no template read as unknown, no_template, and confirms nothing', async () => {
      const { service, insert, dealActions } = build({
        recognised: { senderKnown: false, template: null, amount: null },
      });

      await service.receive(device, input);

      expect(insertedValues(insert)).toEqual(
        expect.objectContaining({
          senderKnown: false,
          messageType: DeviceMessageType.Unknown,
          templateId: null,
          parsedAmount: null,
          matchStatus: DeviceMessageMatchStatus.NoTemplate,
        }),
      );
      expect(dealActions.confirmByDeviceWithin).not.toHaveBeenCalled();
    });

    it.each([BankMessageType.Statement, BankMessageType.Other])(
      'ignores a %s: stored with its type, nothing confirmed',
      async (messageType) => {
        const { service, insert, dealActions } = build({
          recognised: {
            ...recognisedCredit,
            template: { ...credit, messageType } as BankMessageTemplate,
          },
        });

        await service.receive(device, input);

        expect(insertedValues(insert)).toEqual(
          expect.objectContaining({
            messageType,
            matchStatus: DeviceMessageMatchStatus.Ignored,
          }),
        );
        expect(dealActions.confirmByDeviceWithin).not.toHaveBeenCalled();
      },
    );

    it.each([
      UserStatus.Suspended,
      UserStatus.Blocked,
      UserStatus.PendingTwoFactor,
    ])(
      'confirms nothing for an owner who is %s, as the trader could not by hand',
      async (ownerStatus) => {
        const { service, insert, dealActions } = build({ ownerStatus });

        await service.receive(device, input);

        expect(insertedValues(insert)).toEqual(
          expect.objectContaining({
            matchStatus: DeviceMessageMatchStatus.AccountInactive,
          }),
        );
        expect(dealActions.confirmByDeviceWithin).not.toHaveBeenCalled();
      },
    );

    it('answers the row a concurrent repeat inserted, and confirms nothing itself', async () => {
      const { service, manager, dealActions } = build({
        insertedId: null,
      });

      await service.receive(device, input);

      expect(manager.findOneOrFail).toHaveBeenCalledWith(DeviceMessage, {
        where: { deviceId: 7, externalId: 'sms-1' },
      });
      expect(dealActions.confirmByDeviceWithin).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    const query = {
      page: 2,
      limit: 10,
      sortBy: DeviceMessageSortField.CreatedAt,
      sortOrder: SortOrder.Desc,
    };

    it('scopes to the owner and hides unknown senders by default', async () => {
      const { service, messages } = build();

      await service.list(OWNER, query);

      expect(messages.findAndCount).toHaveBeenCalledWith({
        where: [{ userId: OWNER, senderKnown: true }],
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 10,
        take: 10,
      });
    });

    it('puts every filter into the query', async () => {
      const { service, messages } = build();
      const from = new Date('2026-11-01T00:00:00Z');
      const to = new Date('2026-11-02T00:00:00Z');

      await service.list(OWNER, {
        ...query,
        kind: DeviceMessageKind.Push,
        messageType: DeviceMessageType.Credit,
        createdFrom: from,
        createdTo: to,
        deviceId: 7,
        sender: 'T_Bank',
        showUnknownSenders: true,
        transactionId: DEAL,
      });

      expect(messages.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            {
              userId: OWNER,
              kind: DeviceMessageKind.Push,
              messageType: DeviceMessageType.Credit,
              createdAt: And(MoreThanOrEqual(from), LessThanOrEqual(to)),
              deviceId: 7,
              sender: ILike('T\\_Bank'),
              transactionId: DEAL,
            },
          ],
        }),
      );
    });

    it('searches a number as the id or in the text, anything else in the text, escaped', async () => {
      const { service, messages } = build();

      await service.list(OWNER, { ...query, search: '42' });
      await service.list(OWNER, { ...query, search: '50%' });
      await service.list(OWNER, { ...query, search: '99999999999' });

      const base = { userId: OWNER, senderKnown: true };

      expect(
        messages.findAndCount.mock.calls.map(([options]) => options.where),
      ).toEqual([
        [
          { ...base, id: 42 },
          { ...base, text: ILike('%42%') },
        ],
        [{ ...base, text: ILike('%50\\%%') }],
        [{ ...base, text: ILike('%99999999999%') }],
      ]);
    });
  });

  it('counts the tabs under the filters, kind and type set by each tab alone', async () => {
    const { service, messages } = build();

    const counts = await service.countsOf(OWNER, {
      kind: DeviceMessageKind.Sms,
      deviceId: 7,
    });

    expect(counts).toEqual({
      all: 3,
      push: 3,
      sms: 3,
      credit: 3,
      statement: 3,
    });
    expect(messages.count.mock.calls.map(([options]) => options.where)).toEqual(
      [
        [{ userId: OWNER, deviceId: 7, senderKnown: true }],
        [
          {
            userId: OWNER,
            kind: DeviceMessageKind.Push,
            deviceId: 7,
            senderKnown: true,
          },
        ],
        [
          {
            userId: OWNER,
            kind: DeviceMessageKind.Sms,
            deviceId: 7,
            senderKnown: true,
          },
        ],
        [
          {
            userId: OWNER,
            messageType: DeviceMessageType.Credit,
            deviceId: 7,
            senderKnown: true,
          },
        ],
        [
          {
            userId: OWNER,
            messageType: DeviceMessageType.Statement,
            deviceId: 7,
            senderKnown: true,
          },
        ],
      ],
    );
  });
});
