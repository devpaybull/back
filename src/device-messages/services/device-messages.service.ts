import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  ILike,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
  And,
} from 'typeorm';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { Fiat } from '../../common/types/fiat';
import { Page, toPage } from '../../common/types/page';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { INT4_MAX } from '../../common/utils/int4-max';
import { sortDirection } from '../../common/utils/sort-direction';
import { Device } from '../../devices/entities/device.entity';
import { BankMessageType } from '../../message-templates/types/bank-message-type.enum';
import { MessageTemplatesService } from '../../message-templates/message-templates.service';
import { RecognisedMessage } from '../../message-templates/types/recognised-message';
import { TraderDealActionsService } from '../../transactions/services/trader-deal-actions.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { DeviceMessage } from '../entities/device-message.entity';
import { DeviceMessageCounts } from '../types/device-message-counts';
import { DeviceMessageFilter } from '../types/device-message-filter';
import { DeviceMessageKind } from '../types/device-message-kind.enum';
import { DeviceMessageListQuery } from '../types/device-message-list-query';
import { DeviceMessageMatchStatus } from '../types/device-message-match-status.enum';
import { DeviceMessageSortField } from '../types/device-message-sort-field.enum';
import { DeviceMessageType } from '../types/device-message-type.enum';
import { ReceiveDeviceMessageInput } from '../types/receive-device-message-input';

const NUMERIC_ID = /^\d{1,10}$/;

@Injectable()
export class DeviceMessagesService {
  private readonly logger = new Logger(DeviceMessagesService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(DeviceMessage)
    private readonly messages: Repository<DeviceMessage>,
    private readonly templates: MessageTemplatesService,
    private readonly users: UserDirectoryService,
    private readonly requisites: BankDetailsService,
    private readonly dealActions: TraderDealActionsService,
    private readonly config: ConfigService,
  ) {}

  async receive(
    device: Device,
    input: ReceiveDeviceMessageInput,
  ): Promise<DeviceMessage> {
    const stored = await this.messages.findOne({
      where: { deviceId: device.id, externalId: input.externalId },
    });

    if (stored) return stored;

    const recognised = await this.templates.recognise(input.sender, input.text);
    const matchStatus = this.initialMatchStatus(recognised);

    return this.dataSource.transaction(async (manager) => {
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(DeviceMessage)
        .values({
          deviceId: device.id,
          userId: device.userId,
          externalId: input.externalId,
          kind: input.kind,
          sender: input.sender,
          text: input.text,
          receivedAt: input.receivedAt,
          senderKnown: recognised.senderKnown,
          messageType: recognised.template
            ? (recognised.template.messageType as string as DeviceMessageType)
            : DeviceMessageType.Unknown,
          templateId: recognised.template?.id ?? null,
          parsedAmount: recognised.amount,
          matchStatus,
          transactionId: null,
        })
        .orIgnore()
        .returning(['id'])
        .execute();
      const id = (inserted.raw as { id?: number }[])[0]?.id;

      if (id === undefined) {
        return manager.findOneOrFail(DeviceMessage, {
          where: { deviceId: device.id, externalId: input.externalId },
        });
      }

      if (
        matchStatus === DeviceMessageMatchStatus.NoCandidate &&
        recognised.template &&
        recognised.amount
      ) {
        await manager.update(
          DeviceMessage,
          { id },
          await this.confirmWithin(manager, device, id, input.receivedAt, {
            bankId: recognised.template.bankId,
            amountFiat: recognised.amount,
          }),
        );
      }

      return manager.findOneOrFail(DeviceMessage, { where: { id } });
    });
  }

  private async confirmWithin(
    manager: EntityManager,
    device: Device,
    messageId: number,
    receivedAt: Date,
    reading: { bankId: number; amountFiat: Fiat },
  ): Promise<Pick<DeviceMessage, 'matchStatus' | 'transactionId'>> {
    if (
      (await this.users.statusWithin(manager, device.userId)) !==
      UserStatus.Active
    ) {
      return {
        matchStatus: DeviceMessageMatchStatus.AccountInactive,
        transactionId: null,
      };
    }

    const toleranceMs =
      this.config.getOrThrow<number>('DEVICE_MESSAGE_CLOCK_TOLERANCE_SECONDS') *
      1000;

    try {
      const confirmation = await manager.transaction(async (savepoint) =>
        this.dealActions.confirmByDeviceWithin(savepoint, {
          traderUserId: device.userId,
          deviceId: device.id,
          messageId,
          bankId: reading.bankId,
          amountFiat: reading.amountFiat,
          createdNoLaterThan: new Date(receivedAt.getTime() + toleranceMs),
          requisites: await this.requisites.requisitesOfDeviceWithin(
            savepoint,
            device.id,
            device.userId,
          ),
        }),
      );

      return {
        matchStatus: confirmation.outcome as string as DeviceMessageMatchStatus,
        transactionId: confirmation.transactionId,
      };
    } catch (error) {
      this.logger.error(
        `Device message ${messageId} could not confirm a deal: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return {
        matchStatus: DeviceMessageMatchStatus.ConfirmFailed,
        transactionId: null,
      };
    }
  }

  async list(
    userId: string,
    query: DeviceMessageListQuery,
  ): Promise<Page<DeviceMessage>> {
    const direction = sortDirection(query.sortOrder);

    return toPage(
      await this.messages.findAndCount({
        where: this.whereOf(userId, query),
        order:
          query.sortBy === DeviceMessageSortField.Id
            ? { id: direction }
            : { [query.sortBy]: direction, id: direction },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async countsOf(
    userId: string,
    filter: DeviceMessageFilter,
  ): Promise<DeviceMessageCounts> {
    const base = { ...filter, kind: undefined, messageType: undefined };
    const count = (narrowing: DeviceMessageFilter) =>
      this.messages.count({
        where: this.whereOf(userId, { ...base, ...narrowing }),
      });

    return {
      all: await count({}),
      push: await count({ kind: DeviceMessageKind.Push }),
      sms: await count({ kind: DeviceMessageKind.Sms }),
      credit: await count({ messageType: DeviceMessageType.Credit }),
      statement: await count({ messageType: DeviceMessageType.Statement }),
    };
  }

  private initialMatchStatus(
    recognised: RecognisedMessage,
  ): DeviceMessageMatchStatus {
    if (!recognised.template) return DeviceMessageMatchStatus.NoTemplate;
    if (recognised.template.messageType !== BankMessageType.Credit) {
      return DeviceMessageMatchStatus.Ignored;
    }

    return DeviceMessageMatchStatus.NoCandidate;
  }

  private whereOf(
    userId: string,
    filter: DeviceMessageFilter,
  ): FindOptionsWhere<DeviceMessage>[] {
    const createdAt =
      filter.createdFrom && filter.createdTo
        ? And(
            MoreThanOrEqual(filter.createdFrom),
            LessThanOrEqual(filter.createdTo),
          )
        : filter.createdFrom
          ? MoreThanOrEqual(filter.createdFrom)
          : filter.createdTo
            ? LessThanOrEqual(filter.createdTo)
            : undefined;
    const base: FindOptionsWhere<DeviceMessage> = {
      userId,
      ...(filter.kind !== undefined ? { kind: filter.kind } : {}),
      ...(filter.messageType !== undefined
        ? { messageType: filter.messageType }
        : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(filter.deviceId !== undefined ? { deviceId: filter.deviceId } : {}),
      ...(filter.sender !== undefined
        ? { sender: ILike(escapeLikePattern(filter.sender)) }
        : {}),
      ...(filter.showUnknownSenders ? {} : { senderKnown: true }),
      ...(filter.transactionId !== undefined
        ? { transactionId: filter.transactionId }
        : {}),
    };

    if (!filter.search) return [base];

    const byText = {
      ...base,
      text: ILike(`%${escapeLikePattern(filter.search)}%`),
    };
    const id = NUMERIC_ID.test(filter.search) ? Number(filter.search) : null;

    return id !== null && id <= INT4_MAX ? [{ ...base, id }, byText] : [byText];
  }
}
