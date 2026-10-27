import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { MerchantAttachmentKind } from '../../merchants/types/merchant-attachment-kind.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminMerchantAttachmentsController } from '../controllers/admin-merchant-attachments.controller';
import { ReplaceAttachmentsDto } from '../dto/replace-attachments.dto';

const admin = { id: uuidOf(9), role: Role.Admin } as AuthenticatedUser;
const view = (userId: string, kind: MerchantAttachmentKind) => ({
  userId,
  login: 'x',
  status: UserStatus.Active,
  kind,
  trading: true,
  methods: [{ method: 'card', enabled: true }],
});

const build = () => {
  const attachments = {
    list: jest.fn(async () => [
      view(uuidOf(11), MerchantAttachmentKind.Trader),
      view(uuidOf(12), MerchantAttachmentKind.Cascade),
    ]),
    replace: jest.fn(async () => []),
    update: jest.fn(async () =>
      view(uuidOf(11), MerchantAttachmentKind.Trader),
    ),
    remove: jest.fn(async () => []),
  };

  return {
    attachments,
    controller: new AdminMerchantAttachmentsController(attachments as never),
  };
};

describe('AdminMerchantAttachmentsController', () => {
  it('is guarded for admin and superadmin, every mutation a write', () => {
    const { controller } = build();

    expect(
      Reflect.getMetadata(
        ROLES_METADATA_KEY,
        AdminMerchantAttachmentsController,
      ),
    ).toEqual([Role.Admin, Role.Superadmin]);
    for (const handler of [
      controller.replace,
      controller.update,
      controller.remove,
    ]) {
      expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
        true,
      );
    }
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.list),
    ).toBeUndefined();
  });

  it('splits the pairs into traders and cascades by the kind they were attached as', async () => {
    const { controller } = build();

    const result = await controller.list(uuidOf(3));

    expect(result.traders.map((row) => row.userId)).toEqual([uuidOf(11)]);
    expect(result.cascades.map((row) => row.userId)).toEqual([uuidOf(12)]);
  });

  it('refuses an empty edit of one pair with a 400', async () => {
    const { controller, attachments } = build();

    await expect(
      controller.update(uuidOf(3), uuidOf(11), {}, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(attachments.update).not.toHaveBeenCalled();
  });

  it('passes a pair edit through as the admin', async () => {
    const { controller, attachments } = build();

    await controller.update(uuidOf(3), uuidOf(11), { trading: false }, admin);

    expect(attachments.update).toHaveBeenCalledWith(
      uuidOf(3),
      uuidOf(11),
      { trading: false },
      admin.id,
    );
  });

  it('validates the whole set: both sections required, uuids, known methods', async () => {
    const errors = async (body: object) =>
      (await validate(plainToInstance(ReplaceAttachmentsDto, body))).map(
        (error) => error.property,
      );

    expect(await errors({ traders: [] })).toEqual(['cascades']);
    expect(
      await errors({
        traders: [{ userId: 'nope', trading: true, methods: [] }],
        cascades: [],
      }),
    ).toEqual(['traders']);
    expect(
      await errors({
        traders: [
          {
            userId: uuidOf(1),
            trading: true,
            methods: [{ method: 'qr', enabled: true }],
          },
        ],
        cascades: [],
      }),
    ).toEqual(['traders']);
    expect(await errors({ traders: [], cascades: [] })).toEqual([]);
  });
});
