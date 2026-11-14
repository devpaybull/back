import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { createdRange } from '../../common/utils/created-range';
import { formatFiat } from '../../common/utils/format-fiat';
import { loginOf } from '../../common/utils/login-of';
import { DeviceMessage } from '../../device-messages/entities/device-message.entity';
import { DeviceMessagesService } from '../../device-messages/services/device-messages.service';
import { DeviceMessageFilter } from '../../device-messages/types/device-message-filter';
import { UnknownSenders } from '../../device-messages/types/unknown-senders.enum';
import { DevicesService } from '../../devices/devices.service';
import { MessageTemplatesService } from '../../message-templates/message-templates.service';
import { TransactionService } from '../../transactions/services/transaction.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { DeviceMessageCountersDto } from '../dto/device-message-counters.dto';
import { DeviceMessageFilterDto } from '../dto/device-message-filter.dto';
import {
  DeviceMessageDto,
  toDeviceMessageDto,
} from '../dto/device-message.dto';
import { ListDeviceMessagesQueryDto } from '../dto/list-device-messages-query.dto';

@ApiTags('Admin · Device messages')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/device-messages')
export class AdminDeviceMessagesController {
  constructor(
    private readonly messages: DeviceMessagesService,
    private readonly directory: UserDirectoryService,
    private readonly devices: DevicesService,
    private readonly templates: MessageTemplatesService,
    private readonly transactions: TransactionService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The SMS and pushes every trader’s phones handed over',
    description:
      'Read only. Today by default. Filters: kind, messageType (the tabs), period or createdFrom/createdTo (both is a 400), traderUserId, deviceId, deviceName (a piece of the name, deleted devices included), sender, unknownSenders (hide by default), transactionId, search (the id or a piece of the text).',
  })
  @ApiPagedResponse(DeviceMessageDto)
  async list(
    @Query() query: ListDeviceMessagesQueryDto,
  ): Promise<Page<DeviceMessageDto>> {
    const page = await this.messages.list({
      ...this.filterOf(query),
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    return new Page(await this.withDetails(page.items), page.meta);
  }

  @Get('counters')
  @ApiOperation({
    summary:
      'The tab counters under the list’s filters, kind and messageType aside',
  })
  @ApiEnvelopeResponse(DeviceMessageCountersDto)
  counters(
    @Query() query: DeviceMessageFilterDto,
  ): Promise<DeviceMessageCountersDto> {
    return this.messages.countsOf(this.filterOf(query));
  }

  private filterOf(query: DeviceMessageFilterDto): DeviceMessageFilter {
    return {
      ...createdRange(
        query,
        this.config.getOrThrow<string>('BUSINESS_TIMEZONE'),
      ),
      userId: query.traderUserId,
      kind: query.kind,
      messageType: query.messageType,
      deviceId: query.deviceId,
      deviceName: query.deviceName,
      sender: query.sender,
      showUnknownSenders: query.unknownSenders === UnknownSenders.Show,
      transactionId: query.transactionId,
      search: query.search,
    };
  }

  private async withDetails(
    rows: DeviceMessage[],
  ): Promise<DeviceMessageDto[]> {
    const distinct = <T>(values: (T | null | undefined)[]): T[] => [
      ...new Set(
        values.filter(
          (value): value is T => value !== null && value !== undefined,
        ),
      ),
    ];

    const [traders, devices, templates, deals] = await Promise.all([
      this.directory.findByIds(distinct(rows.map((row) => row.userId))),
      this.devices.findByIdsWithDeleted(
        distinct(rows.map((row) => row.deviceId)),
      ),
      this.templates.findByIds(distinct(rows.map((row) => row.templateId))),
      this.transactions.findByIds(
        distinct(rows.map((row) => row.transactionId)),
      ),
    ]);
    const traderById = new Map(traders.map((user) => [user.id, user]));
    const deviceById = new Map(devices.map((device) => [device.id, device]));
    const templateById = new Map(templates.map((row) => [row.id, row]));
    const dealById = new Map(deals.map((deal) => [deal.id, deal]));

    return rows.map((row) => {
      const trader = traderById.get(row.userId);
      const device = deviceById.get(row.deviceId);
      const template = templateById.get(row.templateId);
      const deal = dealById.get(row.transactionId);

      return toDeviceMessageDto(row, {
        trader: trader
          ? {
              id: trader.id,
              login: loginOf(trader),
              telegramUsername: trader.telegramUsername ?? null,
            }
          : null,
        device: device ? { id: device.id, name: device.name } : null,
        senderName: template?.bank?.name ?? null,
        currency: template?.bank?.currency?.isocode ?? null,
        transaction: deal
          ? {
              id: deal.id,
              status: deal.status,
              amountFiat: formatFiat(deal.amountFiat),
            }
          : null,
      });
    });
  }
}
