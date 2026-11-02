import {
  Controller,
  Get,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../audit/services/audit.service';
import { AuditSortField } from '../../audit/types/audit-sort-field.enum';
import {
  MERCHANT_ACTIVITY_ACTIONS,
  MerchantActivityAction,
} from '../../audit/types/merchant-activity-action.enum';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { formatCrypto } from '../../common/utils/format-crypto';
import { loginOf } from '../../common/utils/login-of';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { MerchantBalanceService } from '../../transactions/services/merchant-balance.service';
import { MerchantDealsService } from '../../transactions/services/merchant-deals.service';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { CurrentMerchant } from '../decorators/current-merchant.decorator';
import {
  MerchantAccountDto,
  MerchantRefDto,
} from '../dto/merchant-account.dto';
import { MerchantActivityEntryDto } from '../dto/merchant-activity-entry.dto';
import { MerchantProfileDto } from '../dto/merchant-profile.dto';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';

@ApiTags('Merchant · Account')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard, MerchantScopeGuard)
@Roles(Role.Merchant, Role.MerchantSupport, Role.MerchantAgent)
@Controller('merchant')
export class MerchantAccountController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly balances: MerchantBalanceService,
    private readonly deals: MerchantDealsService,
    private readonly directory: UserDirectoryService,
    private readonly audit: AuditService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary:
      'The cabinet header: the merchant, the account’s role, the balance and the deal badges of the menu',
  })
  @ApiEnvelopeResponse(MerchantAccountDto)
  async me(
    @CurrentMerchant() merchantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MerchantAccountDto> {
    const [merchant, states, counts] = await Promise.all([
      this.requireMerchant(merchantId),
      this.balances.statesByMerchant([merchantId]),
      this.deals.statusCounts(merchantId),
    ]);
    const state = states.get(merchantId)!;

    return {
      merchant,
      role: user.role,
      balance: {
        available: formatCrypto(state.balance),
        escrow: formatCrypto(state.escrow),
        withdrawalReserved: formatCrypto(state.withdrawalReserved),
      },
      deals: {
        active:
          counts[TransactionStatus.Active] + counts[TransactionStatus.Pending],
        disputes:
          counts[TransactionStatus.Dispute] +
          counts[TransactionStatus.ManualReview],
      },
    };
  }

  @Get('profile')
  @ApiOperation({
    summary:
      'The settings page’s profile card: the merchant and the signed-in account',
  })
  @ApiEnvelopeResponse(MerchantProfileDto)
  async profile(
    @CurrentMerchant() merchantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MerchantProfileDto> {
    const [merchant, account] = await Promise.all([
      this.requireMerchant(merchantId),
      this.directory.findById(user.id),
    ]);

    return {
      merchant,
      user: {
        id: account.id,
        login: loginOf(account),
        role: account.role,
        createdAt: account.createdAt,
      },
    };
  }

  @Get('activity')
  @ApiOperation({
    summary: 'The signed-in account’s own recent actions, newest first',
    description:
      'Sign-in, sign-out, password change, links changed, withdrawal requested, paid or rejected.',
  })
  @ApiPagedResponse(MerchantActivityEntryDto)
  async activity(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<MerchantActivityEntryDto>> {
    return (
      await this.audit.list({
        page: query.page,
        limit: query.limit,
        sortBy: AuditSortField.CreatedAt,
        sortOrder: query.sortOrder,
        targetUserId: user.id,
        actions: MERCHANT_ACTIVITY_ACTIONS,
      })
    ).map((record) => ({
      id: record.id,
      action: record.action as MerchantActivityAction,
      metadata: record.metadata,
      createdAt: record.createdAt,
    }));
  }

  private async requireMerchant(merchantId: string): Promise<MerchantRefDto> {
    const merchant = await this.merchants.findById(merchantId);

    if (!merchant) throw new NotFoundException('Merchant not found');

    return { id: merchant.id, name: merchant.name };
  }
}
