import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { toInstant } from '../../common/utils/to-instant';
import {
  MerchantCallbackDto,
  toMerchantCallbackDtoForMerchant,
} from '../../merchant-callbacks/dto/merchant-callback.dto';
import { MerchantCallbacksService } from '../../merchant-callbacks/services/merchant-callbacks.service';
import { CurrentMerchant } from '../decorators/current-merchant.decorator';
import { ListMerchantCallbacksQueryDto } from '../dto/list-merchant-callbacks-query.dto';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';

@ApiTags('Merchant · Callbacks')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard, MerchantScopeGuard)
@Roles(Role.Merchant, Role.MerchantSupport, Role.MerchantAgent)
@Controller('merchant/callbacks')
export class MerchantCallbacksController {
  constructor(
    private readonly callbacks: MerchantCallbacksService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The callbacks of the merchant’s deals, newest first',
  })
  @ApiPagedResponse(MerchantCallbackDto)
  async list(
    @CurrentMerchant() merchantId: string,
    @Query() query: ListMerchantCallbacksQueryDto,
  ): Promise<Page<MerchantCallbackDto>> {
    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');

    return (
      await this.callbacks.listOfMerchant(merchantId, {
        page: query.page,
        limit: query.limit,
        sortOrder: query.sortOrder,
        statuses: query.status,
        createdFrom: toInstant(query.createdFrom, timeZone),
        createdTo: toInstant(query.createdTo, timeZone),
        search: query.search,
      })
    ).map(toMerchantCallbackDtoForMerchant);
  }

  @Post(':id/resend')
  @Roles(Role.Merchant)
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sends a delivered or failed callback again',
    description:
      'A new row with the same eventId and body; the original stays in the history. Anything else, or a second time within a minute, is a 409.',
  })
  @ApiEnvelopeResponse(MerchantCallbackDto)
  async resend(
    @CurrentMerchant() merchantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MerchantCallbackDto> {
    return toMerchantCallbackDtoForMerchant(
      await this.callbacks.resend(id, merchantId),
    );
  }
}
