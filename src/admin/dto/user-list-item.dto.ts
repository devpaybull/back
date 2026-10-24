import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { UserRowDetails } from '../types/user-row-details';
import { BalancesDto } from './balances.dto';
import { BaseMethodRateDto } from './base-rate-set.dto';
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
    nullable: true,
    description:
      'Effective minimum insurance pay-in deposit. Null for roles other than trader and lead_trader.',
  })
  insurancePayInMin: number | null;

  @ApiProperty({
    type: BaseMethodRateDto,
    isArray: true,
    nullable: true,
    description:
      'Effective general rate per payment method: the trader scope for a trader, the lead scope for a lead trader. Null for every other role.',
  })
  rates: BaseMethodRateDto[] | null;

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
