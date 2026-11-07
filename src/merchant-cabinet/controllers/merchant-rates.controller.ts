import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { MerchantCurrencyRatesDto } from '../../transactions/dto/merchant-rates.dto';
import { MerchantRatesService } from '../../transactions/services/merchant-rates.service';
import { CurrentMerchant } from '../decorators/current-merchant.decorator';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';

@ApiTags('Merchant · Rates')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard, MerchantScopeGuard)
@Roles(Role.Merchant, Role.MerchantSupport, Role.MerchantAgent)
@Controller('merchant/rates')
export class MerchantRatesController {
  constructor(private readonly rates: MerchantRatesService) {}

  @Get()
  @ApiOperation({
    summary:
      'The merchant’s rates in force, per currency of the merchant and per switched-on method',
    description:
      'The individual set where one exists, else the base merchant rate; amount bands and bank rows included. A method switched off, or with no rate, is left out; markups on the exchange rate are not here.',
  })
  @ApiEnvelopeResponse(MerchantCurrencyRatesDto, { isArray: true })
  list(
    @CurrentMerchant() merchantId: string,
  ): Promise<MerchantCurrencyRatesDto[]> {
    return this.rates.inForce(merchantId);
  }
}
