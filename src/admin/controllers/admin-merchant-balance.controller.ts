import {
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { toInstant } from '../../common/utils/to-instant';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { MerchantBalanceService } from '../../transactions/services/merchant-balance.service';
import { AdjustMerchantBalanceDto } from '../dto/adjust-merchant-balance.dto';
import { ListMerchantBalanceOperationsQueryDto } from '../dto/list-merchant-balance-operations-query.dto';
import {
  MerchantBalanceOperationDto,
  toMerchantBalanceOperationDto,
} from '../dto/merchant-balance-operation.dto';
import { MerchantBalanceOperationFilterDto } from '../dto/merchant-balance-operation-filter.dto';
import { merchantBalanceOperationsCsv } from '../utils/merchant-balance-operations-csv';
import { BALANCE_EXPORT_MAX_ROWS } from './admin-balances.controller';

@ApiTags('Admin · Merchant balance')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/merchants/:id')
export class AdminMerchantBalanceController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly balances: MerchantBalanceService,
    private readonly config: ConfigService,
  ) {}

  @Get('balance-operations')
  @ApiOperation({
    summary: 'Lists a merchant’s balance journal, newest first',
    description:
      'Filters: from (inclusive) and to (exclusive) on createdAt, type (one or several). A merchant with no balance row gets an empty page.',
  })
  @ApiPagedResponse(MerchantBalanceOperationDto)
  async balanceOperations(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMerchantBalanceOperationsQueryDto,
  ): Promise<Page<MerchantBalanceOperationDto>> {
    await this.requireMerchant(id);

    return (
      await this.balances.listOperations({
        merchantId: id,
        from: toInstant(query.from, this.timeZone()),
        to: toInstant(query.to, this.timeZone()),
        types: query.type,
        page: query.page,
        limit: query.limit,
        sortOrder: query.sortOrder,
      })
    ).map(toMerchantBalanceOperationDto);
  }

  @Get('balance-operations/export')
  @ApiOperation({
    summary: 'Exports a merchant’s balance journal as CSV',
    description: `Same filters as the list, no pagination, newest first. Comma-separated, UTF-8, CRLF line endings, header row. More than ${BALANCE_EXPORT_MAX_ROWS} matching rows is a 400: narrow the period.`,
  })
  @ApiOkResponse({
    description: 'text/csv attachment, not wrapped in the response envelope',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async exportBalanceOperations(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MerchantBalanceOperationFilterDto,
  ): Promise<StreamableFile> {
    await this.requireMerchant(id);

    const operations = await this.balances.exportOperations(
      {
        merchantId: id,
        from: toInstant(query.from, this.timeZone()),
        to: toInstant(query.to, this.timeZone()),
        types: query.type,
      },
      BALANCE_EXPORT_MAX_ROWS,
    );
    const csv = merchantBalanceOperationsCsv(
      operations.map(toMerchantBalanceOperationDto),
    );

    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="merchant-balance-operations-${id}.csv"`,
    });
  }

  @Post('balance/adjustments')
  @Roles(Role.Superadmin)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Changes a merchant’s balance by hand, with a comment; may take it below zero',
  })
  @ApiEnvelopeResponse(MerchantBalanceOperationDto, {
    status: HttpStatus.CREATED,
  })
  async adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustMerchantBalanceDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantBalanceOperationDto> {
    await this.requireMerchant(id);

    return toMerchantBalanceOperationDto(
      await this.balances.adjust({
        merchantId: id,
        direction: dto.direction,
        amount: toCrypto(dto.amount),
        comment: dto.comment,
        actorUserId: admin.id,
      }),
    );
  }

  private async requireMerchant(id: string): Promise<void> {
    if (!(await this.merchants.findById(id))) {
      throw new NotFoundException('Merchant not found');
    }
  }

  private timeZone(): string {
    return this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
  }
}
