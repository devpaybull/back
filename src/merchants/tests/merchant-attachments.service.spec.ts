import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { In, QueryFailedError } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { MerchantAttachmentMethod } from '../entities/merchant-attachment-method.entity';
import { MerchantAttachment } from '../entities/merchant-attachment.entity';
import { MerchantAttachmentsService } from '../services/merchant-attachments.service';
import { MerchantAttachmentKind } from '../types/merchant-attachment-kind.enum';

const MERCHANT = uuidOf(3);
const ACTOR = uuidOf(9);
const TRADER = uuidOf(11);
const CASCADE = uuidOf(12);

const user = (id: string, role: Role, login: string): User =>
  ({
    id,
    role,
    telegramUsername: login,
    email: null,
    status: UserStatus.Active,
  }) as User;

const users = [
  user(TRADER, Role.Trader, 'super_maks'),
  user(CASCADE, Role.Cascade, '24psdyuk'),
];

const build = (
  options: {
    merchantExists?: boolean;
    existing?: MerchantAttachment[];
    deleted?: number;
  } = {},
) => {
  const existing = options.existing ?? [];
  const manager = {
    query: jest.fn(async () => []),
    find: jest.fn(async (entity: unknown): Promise<unknown[]> =>
      entity === MerchantAttachment ? existing : [],
    ),
    findOne: jest.fn(async () => existing[0] ?? null),
    delete: jest.fn(async () => ({ affected: options.deleted ?? 1 })),
    update: jest.fn(async () => undefined),
    merge: jest.fn((_entity: unknown, row: object, data: object) => ({
      ...row,
      ...data,
    })),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (row: object) =>
      Array.isArray(row) ? row : { id: 40, ...row },
    ),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const attachments = {
    find: jest.fn(async () => [] as MerchantAttachment[]),
  };
  const merchants = {
    findOne: jest.fn(async () =>
      options.merchantExists === false ? null : { id: MERCHANT },
    ),
  };
  const directory = {
    findByIds: jest.fn(async (ids: string[]) =>
      users.filter((row) => ids.includes(row.id)),
    ),
  };
  const audit = { record: jest.fn(async () => undefined) };

  return {
    manager,
    attachments,
    directory,
    audit,
    service: new MerchantAttachmentsService(
      attachments as never,
      merchants as never,
      dataSource as never,
      directory as never,
      audit as never,
    ),
  };
};

const entry = (userId: string, enabled = true) => ({
  userId,
  trading: true,
  methods: [
    { method: 'card', enabled },
    { method: 'sbp', enabled: false },
  ],
});

describe('MerchantAttachmentsService.replace', () => {
  it('locks the merchant set first, writes a trader and a cascade with their switches, and audits', async () => {
    const { service, manager, audit } = build();

    await service.replace(
      MERCHANT,
      { traders: [entry(TRADER)], cascades: [entry(CASCADE)] },
      ACTOR,
    );

    expect(manager.query.mock.calls[0]).toEqual([
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`merchant_attachments:${MERCHANT}`],
    ]);
    expect(manager.create).toHaveBeenCalledWith(MerchantAttachment, {
      merchantId: MERCHANT,
      userId: TRADER,
      kind: MerchantAttachmentKind.Trader,
      trading: true,
    });
    expect(manager.create).toHaveBeenCalledWith(MerchantAttachment, {
      merchantId: MERCHANT,
      userId: CASCADE,
      kind: MerchantAttachmentKind.Cascade,
      trading: true,
    });
    expect(manager.create).toHaveBeenCalledWith(MerchantAttachmentMethod, {
      attachmentId: 40,
      method: 'card',
      enabled: true,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merchant.attachments_replaced',
        metadata: {
          merchantId: MERCHANT,
          traders: [TRADER],
          cascades: [CASCADE],
        },
      }),
      manager,
    );
  });

  it('keeps the id of a pair that stays and deletes the pairs that were dropped', async () => {
    const kept = {
      id: 7,
      merchantId: MERCHANT,
      userId: TRADER,
      kind: MerchantAttachmentKind.Trader,
      trading: false,
    } as MerchantAttachment;
    const dropped = {
      ...kept,
      id: 8,
      userId: uuidOf(13),
    } as MerchantAttachment;
    const { service, manager } = build({ existing: [kept, dropped] });

    await service.replace(
      MERCHANT,
      { traders: [entry(TRADER)], cascades: [] },
      ACTOR,
    );

    expect(manager.delete).toHaveBeenCalledWith(MerchantAttachment, {
      id: In([8]),
    });
    expect(manager.merge).toHaveBeenCalledWith(MerchantAttachment, kept, {
      kind: MerchantAttachmentKind.Trader,
      trading: true,
    });
  });

  it.each([
    [
      'a trader in the cascade section',
      { traders: [], cascades: [entry(TRADER)] },
    ],
    [
      'a cascade in the trader section',
      { traders: [entry(CASCADE)], cascades: [] },
    ],
    ['an unknown account', { traders: [entry(uuidOf(77))], cascades: [] }],
    [
      'one account twice',
      { traders: [entry(TRADER)], cascades: [entry(TRADER)] },
    ],
    [
      'an unknown method',
      {
        traders: [
          {
            userId: TRADER,
            trading: true,
            methods: [{ method: 'qr', enabled: true }],
          },
        ],
        cascades: [],
      },
    ],
  ])('answers 400 to %s and writes nothing', async (_label, set) => {
    const { service, manager } = build();

    await expect(service.replace(MERCHANT, set, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown merchant', async () => {
    const { service } = build({ merchantExists: false });

    await expect(
      service.replace(MERCHANT, { traders: [], cascades: [] }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('turns a unique violation raised by a concurrent save into a 409', async () => {
    const { service, manager } = build();
    manager.save.mockRejectedValueOnce(
      new QueryFailedError('INSERT', [], { code: '23505' } as never),
    );

    await expect(
      service.replace(
        MERCHANT,
        { traders: [entry(TRADER)], cascades: [] },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MerchantAttachmentsService.list and counts', () => {
  it('answers every registry method per pair, with the login and the status of the account', async () => {
    const { service, attachments } = build();
    attachments.find.mockResolvedValue([
      {
        id: 7,
        merchantId: MERCHANT,
        userId: TRADER,
        kind: MerchantAttachmentKind.Trader,
        trading: true,
        methods: [{ method: 'card', enabled: true }],
      } as MerchantAttachment,
    ]);

    const [view] = await service.list(MERCHANT);

    expect(view).toEqual({
      userId: TRADER,
      login: 'super_maks',
      status: UserStatus.Active,
      kind: MerchantAttachmentKind.Trader,
      trading: true,
      methods: [
        { method: 'sbp', enabled: false },
        { method: 'card', enabled: true },
        { method: 'counterparty', enabled: false },
        { method: 'mobile_commerce', enabled: false },
      ],
    });
  });

  it('counts traders and cascades per merchant in one query', async () => {
    const { service, attachments } = build();
    attachments.find.mockResolvedValue([
      { merchantId: MERCHANT, kind: MerchantAttachmentKind.Trader },
      { merchantId: MERCHANT, kind: MerchantAttachmentKind.Trader },
      { merchantId: MERCHANT, kind: MerchantAttachmentKind.Cascade },
    ] as MerchantAttachment[]);

    const counts = await service.countsByMerchant([MERCHANT, uuidOf(4)]);

    expect(attachments.find).toHaveBeenCalledTimes(1);
    expect(counts.get(MERCHANT)).toEqual({ traders: 2, cascades: 1 });
    expect(counts.get(uuidOf(4))).toEqual({ traders: 0, cascades: 0 });
  });
});

describe('MerchantAttachmentsService.update and remove', () => {
  const pair = {
    id: 7,
    merchantId: MERCHANT,
    userId: TRADER,
    kind: MerchantAttachmentKind.Trader,
    trading: true,
  } as MerchantAttachment;

  it('flips trading and merges the method switches by method', async () => {
    const { service, manager, audit } = build({ existing: [pair] });
    manager.find.mockImplementation(async (entity: unknown) =>
      entity === MerchantAttachmentMethod
        ? [
            { method: 'card', enabled: true },
            { method: 'sbp', enabled: true },
          ]
        : [],
    );

    await service.update(
      MERCHANT,
      TRADER,
      { trading: false, methods: [{ method: 'sbp', enabled: false }] },
      ACTOR,
    );

    expect(manager.update).toHaveBeenCalledWith(MerchantAttachment, 7, {
      trading: false,
    });
    expect(manager.create).toHaveBeenCalledWith(MerchantAttachmentMethod, {
      attachmentId: 7,
      method: 'card',
      enabled: true,
    });
    expect(manager.create).toHaveBeenCalledWith(MerchantAttachmentMethod, {
      attachmentId: 7,
      method: 'sbp',
      enabled: false,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: TRADER,
        action: 'merchant.attachment_updated',
      }),
      manager,
    );
  });

  it('answers 404 to a pair that does not exist', async () => {
    const { service } = build({ existing: [] });

    await expect(
      service.update(MERCHANT, TRADER, { trading: true }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('detaches a pair with the audit in the same transaction, and 404s when there was none', async () => {
    const { service, manager, audit } = build();

    await service.remove(MERCHANT, TRADER, ACTOR);

    expect(manager.delete).toHaveBeenCalledWith(MerchantAttachment, {
      merchantId: MERCHANT,
      userId: TRADER,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'merchant.attachment_removed' }),
      manager,
    );

    const none = build({ deleted: 0 });
    await expect(
      none.service.remove(MERCHANT, TRADER, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
