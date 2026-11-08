import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { DeviceMessagesService } from '../../device-messages/services/device-messages.service';
import { DeviceMessageFilter } from '../../device-messages/types/device-message-filter';
import { DevicesService } from '../../devices/devices.service';
import { ListTraderMessagesQueryDto } from '../dto/list-trader-messages-query.dto';
import { TraderMessageCountersDto } from '../dto/trader-message-counters.dto';
import { TraderMessageFilterDto } from '../dto/trader-message-filter.dto';
import {
  TraderMessageDto,
  toTraderMessageDto,
} from '../dto/trader-message.dto';
import { UnknownSenders } from '../types/unknown-senders.enum';
import { traderCreatedRange } from '../utils/trader-created-range';

const LIST_DESCRIPTION =
  'Today by default. Filters: kind, messageType (the tabs), period or createdFrom/createdTo, deviceId, sender, unknownSenders (hide by default), transactionId, search (the id or a piece of the text).';

@ApiTags('Trader · Messages')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader')
export class TraderMessagesController {
  constructor(
    private readonly messages: DeviceMessagesService,
    private readonly devices: DevicesService,
    private readonly config: ConfigService,
  ) {}

  @Get('messages')
  @ApiOperation({
    summary: 'The SMS and pushes the trader’s phones handed over',
    description: LIST_DESCRIPTION,
  })
  @ApiPagedResponse(TraderMessageDto)
  list(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: ListTraderMessagesQueryDto,
  ): Promise<Page<TraderMessageDto>> {
    return this.page(trader, query);
  }

  @Get('messages/counters')
  @ApiOperation({
    summary:
      'The tab counters under the list’s filters, kind and messageType aside',
  })
  @ApiEnvelopeResponse(TraderMessageCountersDto)
  counters(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: TraderMessageFilterDto,
  ): Promise<TraderMessageCountersDto> {
    return this.messages.countsOf(trader.id, this.filterOf(query));
  }

  @Get('devices/:id/messages')
  @ApiOperation({
    summary:
      'The messages of one of the trader’s devices, the device page’s tab',
    description: `${LIST_DESCRIPTION} deviceId is the path’s; another trader’s device is a 404.`,
  })
  @ApiPagedResponse(TraderMessageDto)
  async ofDevice(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListTraderMessagesQueryDto,
  ): Promise<Page<TraderMessageDto>> {
    if (!(await this.devices.findOwn(id, trader.id))) {
      throw new NotFoundException('Device not found');
    }

    return this.page(trader, { ...query, deviceId: id });
  }

  private async page(
    trader: AuthenticatedUser,
    query: ListTraderMessagesQueryDto,
  ): Promise<Page<TraderMessageDto>> {
    return (
      await this.messages.list(trader.id, {
        ...this.filterOf(query),
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      })
    ).map(toTraderMessageDto);
  }

  private filterOf(query: TraderMessageFilterDto): DeviceMessageFilter {
    return {
      ...traderCreatedRange(
        query,
        this.config.getOrThrow<string>('BUSINESS_TIMEZONE'),
      ),
      kind: query.kind,
      messageType: query.messageType,
      deviceId: query.deviceId,
      sender: query.sender,
      showUnknownSenders: query.unknownSenders === UnknownSenders.Show,
      transactionId: query.transactionId,
      search: query.search,
    };
  }
}
