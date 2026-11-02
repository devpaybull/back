import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantActivityAction } from '../../audit/types/merchant-activity-action.enum';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AuthenticatedUser } from '../../common/types/token';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { CurrentMerchant } from '../decorators/current-merchant.decorator';
import { MerchantLinksDto } from '../dto/merchant-links.dto';
import { UpdateMerchantLinksDto } from '../dto/update-merchant-links.dto';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';

@ApiTags('Merchant · Settings')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard, MerchantScopeGuard)
@Roles(Role.Merchant, Role.MerchantSupport, Role.MerchantAgent)
@Controller('merchant/settings')
export class MerchantSettingsController {
  constructor(
    private readonly settings: MerchantSettingsService,
    private readonly merchants: MerchantsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'The support link, the integration URLs and the API key (without its secret)',
  })
  @ApiEnvelopeResponse(MerchantLinksDto)
  read(@CurrentMerchant() merchantId: string): Promise<MerchantLinksDto> {
    return this.linksOf(merchantId);
  }

  @Patch()
  @Roles(Role.Merchant)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Changes the support link and the callback, success and error URLs (merchant only); an empty body is a 400',
  })
  @ApiEnvelopeResponse(MerchantLinksDto)
  async update(
    @CurrentMerchant() merchantId: string,
    @Body() dto: UpdateMerchantLinksDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MerchantLinksDto> {
    await this.settings.update(
      merchantId,
      {
        supportLink: dto.supportLink,
        callbackUrl: dto.callbackUrl,
        successUrl: dto.successUrl,
        errorUrl: dto.errorUrl,
      },
      user.id,
      MerchantActivityAction.LinksUpdated,
    );

    return this.linksOf(merchantId);
  }

  private async linksOf(merchantId: string): Promise<MerchantLinksDto> {
    const [settings, key] = await Promise.all([
      this.settings.settingsOf(merchantId),
      this.merchants.newestActiveKey(merchantId),
    ]);

    return {
      supportLink: settings.supportLink,
      callbackUrl: settings.callbackUrl,
      successUrl: settings.successUrl,
      errorUrl: settings.errorUrl,
      apiKey: key
        ? { id: key.id, key: key.key, createdAt: key.createdAt }
        : null,
    };
  }
}
