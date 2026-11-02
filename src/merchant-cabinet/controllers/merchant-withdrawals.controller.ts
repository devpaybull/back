import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateWithdrawalDto } from '../../account-transactions/dto/create-withdrawal.dto';
import { WithdrawalQuoteQueryDto } from '../../account-transactions/dto/withdrawal-quote-query.dto';
import {
  toWithdrawalQuoteDto,
  WithdrawalQuoteDto,
} from '../../account-transactions/dto/withdrawal-quote.dto';
import { AccountTransactionsService } from '../../account-transactions/services/account-transactions.service';
import { WithdrawalsService } from '../../account-transactions/services/withdrawals.service';
import { AccountTransactionSortField } from '../../account-transactions/types/account-transaction-sort-field.enum';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
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
import { INT4_MAX } from '../../common/utils/int4-max';
import { toCrypto } from '../../common/utils/to-crypto';
import { toInstant } from '../../common/utils/to-instant';
import { CurrentMerchant } from '../decorators/current-merchant.decorator';
import { ListMerchantWithdrawalsQueryDto } from '../dto/list-merchant-withdrawals-query.dto';
import {
  MerchantWithdrawalDto,
  toMerchantWithdrawalDto,
} from '../dto/merchant-withdrawal.dto';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';
import { MerchantWithdrawalSortField } from '../types/merchant-withdrawal-sort-field.enum';

const requireStoredId = (id: number): void => {
  if (id < 1 || id > INT4_MAX)
    throw new NotFoundException('Withdrawal not found');
};

@ApiTags('Merchant · Withdrawals')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard, MerchantScopeGuard)
@Roles(Role.Merchant, Role.MerchantSupport, Role.MerchantAgent)
@Controller('merchant/withdrawals')
export class MerchantWithdrawalsController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly operations: AccountTransactionsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The merchant’s withdrawal requests',
    description:
      'search: a piece of the wallet address or of a transaction hash; createdFrom/createdTo; sortBy createdAt or amount.',
  })
  @ApiPagedResponse(MerchantWithdrawalDto)
  async list(
    @CurrentMerchant() merchantId: string,
    @Query() query: ListMerchantWithdrawalsQueryDto,
  ): Promise<Page<MerchantWithdrawalDto>> {
    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');

    return (
      await this.operations.list({
        type: AccountTransactionType.Withdrawal,
        merchantId,
        page: query.page,
        limit: query.limit,
        sortOrder: query.sortOrder,
        sortBy:
          query.sortBy === MerchantWithdrawalSortField.Amount
            ? AccountTransactionSortField.Amount
            : AccountTransactionSortField.CreatedAt,
        createdFrom: toInstant(query.createdFrom, timeZone),
        createdTo: toInstant(query.createdTo, timeZone),
        search: query.search,
      })
    ).map(toMerchantWithdrawalDto);
  }

  @Get('quote')
  @Roles(Role.Merchant)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Quotes the network fee and the maximum against the merchant’s available balance (merchant only)',
  })
  @ApiEnvelopeResponse(WithdrawalQuoteDto)
  async quote(
    @CurrentMerchant() merchantId: string,
    @Query() query: WithdrawalQuoteQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WithdrawalQuoteDto> {
    return toWithdrawalQuoteDto(
      await this.withdrawals.quoteForMerchant(
        merchantId,
        user.id,
        query.address,
        toCrypto(query.amount),
      ),
    );
  }

  @Post()
  @Roles(Role.Merchant)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Requests a withdrawal (merchant only, TOTP); amount and the quoted fee are held, an admin pays by hand',
  })
  @ApiEnvelopeResponse(MerchantWithdrawalDto, { status: HttpStatus.CREATED })
  async create(
    @CurrentMerchant() merchantId: string,
    @Body() dto: CreateWithdrawalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MerchantWithdrawalDto> {
    return toMerchantWithdrawalDto(
      await this.withdrawals.requestForMerchant({
        merchantId,
        userId: user.id,
        address: dto.address,
        amount: toCrypto(dto.amount),
        totp: dto.totp,
      }),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of the merchant’s withdrawal requests' })
  @ApiEnvelopeResponse(MerchantWithdrawalDto)
  async findOne(
    @CurrentMerchant() merchantId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MerchantWithdrawalDto> {
    requireStoredId(id);

    return toMerchantWithdrawalDto(
      await this.withdrawals.findOwnForMerchant(id, merchantId),
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Merchant)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Cancels a request an admin has not paid yet (merchant only); the hold returns',
  })
  @ApiEnvelopeResponse(MerchantWithdrawalDto)
  async cancel(
    @CurrentMerchant() merchantId: string,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MerchantWithdrawalDto> {
    requireStoredId(id);

    return toMerchantWithdrawalDto(
      await this.withdrawals.cancelOwnForMerchant(id, merchantId, user.id),
    );
  }
}
