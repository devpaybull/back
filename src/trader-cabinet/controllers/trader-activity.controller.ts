import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../audit/services/audit.service';
import { ActivityAction } from '../../audit/types/activity-action.enum';
import { AuditSortField } from '../../audit/types/audit-sort-field.enum';
import { TraderActivityAction } from '../../audit/types/trader-activity-action.enum';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { TraderActivityEntryDto } from '../dto/trader-activity-entry.dto';

const REQUISITE = [
  'id',
  'type',
  'card',
  'phone',
  'cardholderName',
  'bankName',
  'mobileOperatorName',
];
const DEVICE = ['id', 'name', 'model'];

const SHOWN_FIELDS: Record<string, readonly string[]> = {
  [TraderActivityAction.Login]: [],
  [TraderActivityAction.Logout]: [],
  [ActivityAction.TradingEnabled]: [],
  [ActivityAction.TradingDisabled]: [],
  [ActivityAction.BankDetailsAdded]: REQUISITE,
  'bank_details.updated': [...REQUISITE, 'fields'],
  [ActivityAction.BankDetailsDeleted]: REQUISITE,
  [ActivityAction.DeviceAdded]: DEVICE,
  [ActivityAction.DeviceDeleted]: DEVICE,
  'trader.deal_confirmed': ['transactionId'],
  'trader.deal_confirmed_changed': [
    'transactionId',
    'amountFiat',
    'originalAmountFiat',
  ],
  'trader.deal_declined': ['transactionId', 'reasonCode', 'comment'],
  'trader.payout_taken': ['transactionId', 'traderAmount'],
  'trader.payout_completed': ['transactionId'],
  'trader.payout_declined': ['transactionId', 'reasonCode', 'comment'],
  'trader.appeal_accepted': ['transactionId'],
  'trader.appeal_contested': ['transactionId', 'comment'],
  [ActivityAction.DepositCredited]: ['amount'],
  [ActivityAction.WithdrawalCompleted]: ['amount', 'fee'],
  'balance.transfer': ['from', 'to', 'amount'],
};

const MONEY_ACTIONS_OF_ANY_ACTOR: readonly string[] = [
  ActivityAction.DepositCredited,
  ActivityAction.WithdrawalCompleted,
];

const OWN_OR_SYSTEM_ACTIONS = Object.keys(SHOWN_FIELDS).filter(
  (action) => !MONEY_ACTIONS_OF_ANY_ACTOR.includes(action),
);

@ApiTags('Trader · Settings')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader')
export class TraderActivityController {
  constructor(private readonly audit: AuditService) {}

  @Get('activity')
  @ApiOperation({
    summary: '«Активность»: what the trader did, newest first',
    description:
      'Sign-in and sign-out, trading switched, requisites and devices added, changed or deleted, deals confirmed or declined, pay-outs taken, completed or declined, appeals answered, deposits credited, withdrawals completed, moves between own balances. Only rows the trader did or the system did for them; of an admin’s actions only a deposit credited or a withdrawal completed by hand, without naming the admin. No IP, no technical fields.',
  })
  @ApiPagedResponse(TraderActivityEntryDto)
  async activity(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<TraderActivityEntryDto>> {
    return (
      await this.audit.list({
        page: query.page,
        limit: query.limit,
        sortBy: AuditSortField.CreatedAt,
        sortOrder: query.sortOrder,
        targetUserId: trader.id,
        actorUserIdOrSystem: trader.id,
        actions: OWN_OR_SYSTEM_ACTIONS,
        anyActorActions: MONEY_ACTIONS_OF_ANY_ACTOR,
      })
    ).map((record) => ({
      id: record.id,
      action: record.action,
      details: Object.fromEntries(
        (SHOWN_FIELDS[record.action] ?? [])
          .filter((field) => record.metadata && field in record.metadata)
          .map((field) => [field, record.metadata?.[field]]),
      ),
      createdAt: record.createdAt,
    }));
  }
}
