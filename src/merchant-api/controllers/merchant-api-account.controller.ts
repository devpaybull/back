import {
  Controller,
  Get,
  ServiceUnavailableException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatRate } from '../../common/utils/format-rate';
import { MerchantCurrencyRatesDto } from '../../transactions/dto/merchant-rates.dto';
import { MerchantBalanceService } from '../../transactions/services/merchant-balance.service';
import { MerchantRatesService } from '../../transactions/services/merchant-rates.service';
import { MerchantExchangeRate } from '../../transactions/types/merchant-exchange-rate';
import { CurrentApiMerchant } from '../decorators/current-api-merchant.decorator';
import { ApiExchangeRateDto } from '../dto/api-exchange-rate.dto';
import { ApiMerchantBalanceDto } from '../dto/api-merchant-balance.dto';
import { MerchantApiErrorDto } from '../dto/merchant-api-error.dto';
import { MerchantApiExceptionFilter } from '../filters/merchant-api-exception.filter';
import { MerchantApiKeyGuard } from '../guards/merchant-api-key.guard';
import { ApiMerchant } from '../types/api-merchant';
import { MerchantApiErrorCode } from '../types/merchant-api-error-code.enum';

@ApiTags('Merchant API · Account')
@ApiSecurity('X-Secure-Key')
@ApiDefaultResponse({
  type: MerchantApiErrorDto,
  description: 'An error: { statusCode, code, message, details? }',
})
@Public()
@UseGuards(MerchantApiKeyGuard)
@UseFilters(MerchantApiExceptionFilter)
@Controller('v1')
export class MerchantApiAccountController {
  constructor(
    private readonly balances: MerchantBalanceService,
    private readonly rates: MerchantRatesService,
  ) {}

  @Get('merchant/balance')
  @ApiOperation({
    summary: 'The merchant’s available balance and pay-out escrow, in USDT',
  })
  @ApiEnvelopeResponse(ApiMerchantBalanceDto)
  async balance(
    @CurrentApiMerchant() merchant: ApiMerchant,
  ): Promise<ApiMerchantBalanceDto> {
    const states = await this.balances.statesByMerchant([merchant.merchantId]);
    const state = states.get(merchant.merchantId)!;

    return {
      available: formatCrypto(state.balance),
      escrow: formatCrypto(state.escrow),
      currency: 'USDT',
    };
  }

  @Get('payment/rate')
  @ApiOperation({
    summary:
      'The exchange rate a new deal gets, per merchant currency and direction',
    description:
      'Only the currencies the rate source prices (RUB). The last rate fetched is used however old; 503 RATE_UNAVAILABLE when none was ever fetched.',
  })
  @ApiEnvelopeResponse(ApiExchangeRateDto, { isArray: true })
  async exchangeRates(
    @CurrentApiMerchant() merchant: ApiMerchant,
  ): Promise<ApiExchangeRateDto[]> {
    let rates: MerchantExchangeRate[];

    try {
      rates = await this.rates.exchangeRates(merchant.merchantId);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new ServiceUnavailableException({
          code: MerchantApiErrorCode.RateUnavailable,
          message: 'The exchange rate is unavailable',
        });
      }
      throw error;
    }

    return rates.map((row) => ({
      currency: row.currency,
      type: row.type,
      rate: formatRate(row.rate),
    }));
  }

  @Get('payment/methods')
  @ApiOperation({
    summary:
      'The merchant’s switched-on methods with their directions and percents',
    description:
      'The same as the cabinet’s rates: per merchant currency, the individual set where one exists, else the base rate; amount bands and bank rows included.',
  })
  @ApiEnvelopeResponse(MerchantCurrencyRatesDto, { isArray: true })
  methods(
    @CurrentApiMerchant() merchant: ApiMerchant,
  ): Promise<MerchantCurrencyRatesDto[]> {
    return this.rates.inForce(merchant.merchantId);
  }
}
