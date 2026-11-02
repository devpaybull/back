import {
  Controller,
  Get,
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
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { toInstant } from '../../common/utils/to-instant';
import { MerchantBalanceService } from '../../transactions/services/merchant-balance.service';
import { CurrentMerchant } from '../decorators/current-merchant.decorator';
import {
  CabinetBalanceOperationDto,
  toCabinetBalanceOperationDto,
} from '../dto/cabinet-balance-operation.dto';
import { CabinetBalanceOperationFilterDto } from '../dto/cabinet-balance-operation-filter.dto';
import { ListCabinetBalanceOperationsQueryDto } from '../dto/list-cabinet-balance-operations-query.dto';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';
import { cabinetBalanceOperationsCsv } from '../utils/cabinet-balance-operations-csv';
import { CABINET_EXPORT_MAX_ROWS } from '../utils/cabinet-export-max-rows';

@ApiTags('Merchant · Balance')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard, MerchantScopeGuard)
@Roles(Role.Merchant, Role.MerchantSupport, Role.MerchantAgent)
@Controller('merchant/balance-operations')
export class MerchantBalanceController {
  constructor(
    private readonly balances: MerchantBalanceService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '«История операций»: the merchant balance journal, newest first',
    description:
      'Filters: from (inclusive) / to (exclusive), type (the «Причины»), search — a piece of the deal number. No actor is shown; a hand adjustment carries the superadmin’s comment.',
  })
  @ApiPagedResponse(CabinetBalanceOperationDto)
  async list(
    @CurrentMerchant() merchantId: string,
    @Query() query: ListCabinetBalanceOperationsQueryDto,
  ): Promise<Page<CabinetBalanceOperationDto>> {
    return (
      await this.balances.listOperations({
        ...this.filterOf(merchantId, query),
        page: query.page,
        limit: query.limit,
        sortOrder: query.sortOrder,
      })
    ).map(toCabinetBalanceOperationDto);
  }

  @Get('export')
  @ApiOperation({
    summary: 'The same journal as CSV',
    description: `Same filters, newest first, comma-separated, UTF-8, CRLF. More than ${CABINET_EXPORT_MAX_ROWS} rows is a 400.`,
  })
  @ApiOkResponse({
    description: 'text/csv attachment, not wrapped in the response envelope',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async export(
    @CurrentMerchant() merchantId: string,
    @Query() query: CabinetBalanceOperationFilterDto,
  ): Promise<StreamableFile> {
    const rows = await this.balances.exportOperations(
      this.filterOf(merchantId, query),
      CABINET_EXPORT_MAX_ROWS,
    );
    const csv = cabinetBalanceOperationsCsv(
      rows.map(toCabinetBalanceOperationDto),
    );

    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="balance-operations.csv"',
    });
  }

  private filterOf(
    merchantId: string,
    query: CabinetBalanceOperationFilterDto,
  ) {
    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');

    return {
      merchantId,
      from: toInstant(query.from, timeZone),
      to: toInstant(query.to, timeZone),
      types: query.type,
      transactionIdSearch: query.search,
    };
  }
}
