import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Page } from '../../common/types/page';
import { toFiat } from '../../common/utils/to-fiat';
import { toInstant } from '../../common/utils/to-instant';
import { PaymentDto } from '../../transactions/dto/payment.dto';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { CurrentApiMerchant } from '../decorators/current-api-merchant.decorator';
import { SkipIpCheck } from '../decorators/skip-ip-check.decorator';
import { CreatePayInDto } from '../dto/create-pay-in.dto';
import { CreatePayOutDto } from '../dto/create-pay-out.dto';
import { ListPaymentsQueryDto } from '../dto/list-payments-query.dto';
import { MerchantApiExceptionFilter } from '../filters/merchant-api-exception.filter';
import { MerchantApiKeyGuard } from '../guards/merchant-api-key.guard';
import { MerchantApiService } from '../merchant-api.service';
import { ApiMerchant } from '../types/api-merchant';
import { MerchantApiErrorCode } from '../types/merchant-api-error-code.enum';
import { MerchantApiRequest } from '../types/merchant-api-request';
import { PaymentSortField } from '../types/payment-sort-field.enum';

const SAME_REQUEST_HEADER = 'X-Same-Request';

const SORT_FIELDS: Record<PaymentSortField, TransactionSortField> = {
  [PaymentSortField.CreatedAt]: TransactionSortField.CreatedAt,
  [PaymentSortField.ResolvedAt]: TransactionSortField.ResolvedAt,
  [PaymentSortField.Amount]: TransactionSortField.AmountFiat,
};

const DealIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new NotFoundException({
      code: MerchantApiErrorCode.DealNotFound,
      message: 'Deal not found',
    }),
});

@ApiTags('Merchant API · Payments')
@ApiHeader({ name: 'X-Secure-Key', required: true })
@Public()
@UseGuards(MerchantApiKeyGuard)
@UseFilters(MerchantApiExceptionFilter)
@Controller('v1/payment')
export class MerchantApiPaymentsController {
  constructor(
    private readonly payments: MerchantApiService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The merchant’s deals',
    description:
      'Filters: status (a list), type, method, createdFrom/createdTo. search matches a merchantTransactionId exactly, or a deal id. No period limit.',
  })
  @ApiPagedResponse(PaymentDto)
  listPayments(
    @CurrentApiMerchant() merchant: ApiMerchant,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<Page<PaymentDto>> {
    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');

    return this.payments.listPayments(merchant.merchantId, {
      page: query.page,
      limit: query.limit,
      sortBy: SORT_FIELDS[query.sortBy],
      sortOrder: query.sortOrder,
      statuses: query.status,
      kind: query.type,
      method: query.method,
      createdFrom: toInstant(query.createdFrom, timeZone),
      createdTo: toInstant(query.createdTo, timeZone),
      reference: query.search || undefined,
    });
  }

  @Get('merchant/:merchantTransactionId')
  @ApiOperation({
    summary: 'A deal by the merchant’s own merchantTransactionId',
    description: 'None under this merchant is a 404 DEAL_NOT_FOUND.',
  })
  @ApiEnvelopeResponse(PaymentDto)
  findByMerchantTransactionId(
    @CurrentApiMerchant() merchant: ApiMerchant,
    @Param('merchantTransactionId') merchantTransactionId: string,
  ): Promise<PaymentDto> {
    return this.payments.findPaymentByMerchantTransactionId(
      merchant.merchantId,
      merchantTransactionId,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'A deal by its id',
    description:
      'Another merchant’s deal, a missing one or an id that is not a uuid is a 404 DEAL_NOT_FOUND.',
  })
  @ApiEnvelopeResponse(PaymentDto)
  findOne(
    @CurrentApiMerchant() merchant: ApiMerchant,
    @Param('id', DealIdPipe) id: string,
  ): Promise<PaymentDto> {
    return this.payments.findPayment(merchant.merchantId, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an active pay-in or a pending pay-out',
    description:
      'The escrow or the hold is released. A deal already canceled answers 200 as it is; any other status is a 409 DEAL_NOT_CANCELABLE.',
  })
  @ApiEnvelopeResponse(PaymentDto)
  cancel(
    @CurrentApiMerchant() merchant: ApiMerchant,
    @Param('id', DealIdPipe) id: string,
  ): Promise<PaymentDto> {
    return this.payments.cancelPayment(merchant.merchantId, id);
  }

  @Post(':id/extend-timer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Extend a pay-in’s timer once, by its original window',
    description:
      'Only a pay-in whose timer is still running (active or checking, before expiresAt), once per deal; otherwise 409 TIMER_NOT_EXTENDABLE.',
  })
  @ApiEnvelopeResponse(PaymentDto)
  extendTimer(
    @CurrentApiMerchant() merchant: ApiMerchant,
    @Param('id', DealIdPipe) id: string,
  ): Promise<PaymentDto> {
    return this.payments.extendPaymentTimer(merchant.merchantId, id);
  }

  @Post('pay-in')
  @ApiOperation({
    summary: 'Create a pay-in and get the requisite the client pays to',
    description:
      'A repeat with the same merchantTransactionId and the same method, amount and bank answers 200 with that deal; another body is 409. With «same requests» on, an active deal of the same client, amount and method is answered 200 with X-Same-Request: true.',
  })
  @ApiEnvelopeResponse(PaymentDto, { status: HttpStatus.CREATED })
  @ApiEnvelopeResponse(PaymentDto, {
    description: 'An idempotent repeat, or the same request',
  })
  async payIn(
    @CurrentApiMerchant() merchant: ApiMerchant,
    @Body() dto: CreatePayInDto,
    @Req() request: MerchantApiRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentDto> {
    request.requestDetails = {};

    const outcome = await this.payments.createPayIn(
      merchant.merchantId,
      request.requestId ?? null,
      {
        method: dto.method,
        amount: toFiat(dto.amount),
        currency: dto.currency,
        merchantTransactionId: dto.merchantTransactionId,
        payerInfo: { ...dto.payerInfo },
        bank: dto.bank,
        payerBank: dto.payerBank,
        operator: dto.operator,
        callbackUrl: dto.callbackUrl,
        successUrl: dto.successUrl,
        errorUrl: dto.errorUrl,
      },
      request.requestDetails,
    );

    if (!outcome.created) response.status(HttpStatus.OK);
    if (outcome.sameRequest) response.setHeader(SAME_REQUEST_HEADER, 'true');

    return outcome.payment;
  }

  @Post('pay-out')
  @SkipIpCheck()
  @ApiOperation({
    summary: 'Create a pay-out to the recipient’s card or SBP number',
    description:
      'The deal is pending with no trader; the rate, the merchant amount and the hold on the merchant balance are fixed now (409 INSUFFICIENT_BALANCE without the payout overdraft). Not subject to the IP whitelist. A repeat with the same merchantTransactionId, method, amount and recipient answers 200 with that deal; another body is 409.',
  })
  @ApiEnvelopeResponse(PaymentDto, { status: HttpStatus.CREATED })
  @ApiEnvelopeResponse(PaymentDto, { description: 'An idempotent repeat' })
  async payOut(
    @CurrentApiMerchant() merchant: ApiMerchant,
    @Body() dto: CreatePayOutDto,
    @Req() request: MerchantApiRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentDto> {
    request.requestDetails = {};

    const outcome = await this.payments.createPayOut(
      merchant.merchantId,
      {
        method: dto.method,
        amount: toFiat(dto.amount),
        currency: dto.currency,
        merchantTransactionId: dto.merchantTransactionId,
        requisite: { ...dto.requisite },
        callbackUrl: dto.callbackUrl,
        timeoutInMin: dto.timeoutInMin,
        payerInfo: dto.payerInfo && { ...dto.payerInfo },
      },
      request.requestDetails,
    );

    if (!outcome.created) response.status(HttpStatus.OK);

    return outcome.payment;
  }
}
