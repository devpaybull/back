import { Controller, Get, UseFilters, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { formatCrypto } from '../../common/utils/format-crypto';
import { MerchantBalanceService } from '../../transactions/services/merchant-balance.service';
import { CurrentApiMerchant } from '../decorators/current-api-merchant.decorator';
import { ApiMerchantBalanceDto } from '../dto/api-merchant-balance.dto';
import { MerchantApiExceptionFilter } from '../filters/merchant-api-exception.filter';
import { MerchantApiKeyGuard } from '../guards/merchant-api-key.guard';
import { ApiMerchant } from '../types/api-merchant';

@ApiTags('Merchant API · Account')
@ApiHeader({ name: 'X-Secure-Key', required: true })
@Public()
@UseGuards(MerchantApiKeyGuard)
@UseFilters(MerchantApiExceptionFilter)
@Controller('v1/merchant')
export class MerchantApiAccountController {
  constructor(private readonly balances: MerchantBalanceService) {}

  @Get('balance')
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
}
