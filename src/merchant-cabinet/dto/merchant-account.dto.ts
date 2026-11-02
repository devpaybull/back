import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';

export class MerchantRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class MerchantBalanceSummaryDto {
  @ApiProperty({
    type: String,
    example: '120500.500000',
    description: 'the available balance — «Мой баланс», what can be withdrawn',
  })
  available: string;

  @ApiProperty({
    type: String,
    description: 'held for pay-out deals in progress',
  })
  escrow: string;

  @ApiProperty({
    type: String,
    description: 'held for withdrawal requests not paid or canceled yet',
  })
  withdrawalReserved: string;
}

export class MerchantDealBadgesDto {
  @ApiProperty({ description: 'active + pending deals, now' })
  active: number;

  @ApiProperty({ description: 'dispute + manual_review deals, now' })
  disputes: number;
}

export class MerchantAccountDto {
  @ApiProperty({ type: MerchantRefDto })
  merchant: MerchantRefDto;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({ type: MerchantBalanceSummaryDto })
  balance: MerchantBalanceSummaryDto;

  @ApiProperty({ type: MerchantDealBadgesDto })
  deals: MerchantDealBadgesDto;
}
