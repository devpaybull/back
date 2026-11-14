import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { UserRowDetails } from '../types/user-row-details';
import { BalancesDto } from './balances.dto';
import { TradingStatus } from '../types/trading-status.enum';
import { BaseMethodRateDto } from './base-rate-set.dto';
import { RateSummaryDto } from './rate-summary.dto';
import { TeamMemberDto } from './team-member.dto';
import { toUserDto, UserDto } from './user.dto';
import { UserMerchantDto } from './user-merchant.dto';

export class UserListItemDto extends UserDto {
  @ApiProperty({
    type: BalancesDto,
    nullable: true,
    description:
      'Every wallet amount. Null for roles other than trader and lead_trader, and for an account with no wallet yet.',
  })
  balances: BalancesDto | null;

  @ApiProperty({
    type: String,
    example: '100.000000',
    nullable: true,
    description:
      'Effective minimum insurance pay-in deposit. Null for roles other than trader and lead_trader.',
  })
  insurancePayInMin: string | null;

  @ApiProperty({
    type: String,
    example: '300.000000',
    nullable: true,
    description:
      'Effective minimum insurance pay-out deposit: the account override, else INSURANCE_PAY_OUT_MIN. Null for roles other than trader and lead_trader.',
  })
  insurancePayOutMin: string | null;

  @ApiProperty({
    enum: TradingStatus,
    nullable: true,
    description:
      'blocked when the account is blocked or suspended, else the pay-in trading switch (no settings row = disabled). Null for roles other than trader and lead_trader.',
  })
  tradingStatus: TradingStatus | null;

  @ApiProperty({
    type: BaseMethodRateDto,
    isArray: true,
    nullable: true,
    description:
      'Effective general rate per payment method: the trader scope for a trader, the lead scope for a lead trader. Null for every other role.',
  })
  rates: BaseMethodRateDto[] | null;

  @ApiProperty({
    type: RateSummaryDto,
    isArray: true,
    nullable: true,
    description:
      'Min–max of the percents per currency of the method. A trader: every rate that applies — the base general rate with individual rates off; with them on, every individual row (general, bands, banks) plus the base general rate of each method without an individual general one. A lead trader: every share — the assignment rate of each trader_leads row and every lead_rates row. [] when nothing applies. Null for every other role.',
  })
  rateSummary: RateSummaryDto[] | null;

  @ApiProperty({
    type: TeamMemberDto,
    isArray: true,
    nullable: true,
    description: 'The lead traders leading this trader. Null unless trader.',
  })
  leads: TeamMemberDto[] | null;

  @ApiProperty({
    type: TeamMemberDto,
    isArray: true,
    nullable: true,
    description: 'The traders this lead trader leads. Null unless lead_trader.',
  })
  subordinates: TeamMemberDto[] | null;

  @ApiProperty({
    type: UserMerchantDto,
    nullable: true,
    description:
      'The merchant the account belongs to. Null unless merchant, merchant_support or merchant_agent.',
  })
  merchant: UserMerchantDto | null;
}

export const toUserListItemDto = (
  user: User,
  details: UserRowDetails,
): UserListItemDto => ({ ...toUserDto(user), ...details });
