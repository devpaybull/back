import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import { Invite } from '../../invites/entities/invite.entity';
import { InviteStatus, inviteStatus } from '../../invites/types/invite-status';
import { InviteTerms } from '../types/invite-terms';
import { BaseMethodRateDto } from './base-rate-set.dto';
import { InviteAccountDto, toInviteAccountDto } from './invite-account.dto';

export class InviteDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ nullable: true })
  telegramUsername: string | null;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      'The merchant a merchant_support or merchant_agent invite binds the account to',
  })
  merchantId: string | null;

  @ApiProperty()
  code: string;

  @ApiProperty({ enum: InviteStatus })
  status: InviteStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiPropertyOptional({ nullable: true })
  usedAt: Date;

  @ApiPropertyOptional({ type: InviteAccountDto, nullable: true })
  usedBy: InviteAccountDto;

  @ApiPropertyOptional({ nullable: true })
  revokedAt: Date;

  @ApiPropertyOptional({ type: InviteAccountDto, nullable: true })
  revokedBy: InviteAccountDto;

  @ApiProperty({ type: InviteAccountDto })
  createdBy: InviteAccountDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    type: BaseMethodRateDto,
    isArray: true,
    nullable: true,
    description:
      "General rate per payment method. Null for non-trader invites. Until the invite is redeemed these are the default trader rates; after redemption, the redeeming account's own effective rates.",
  })
  rates: BaseMethodRateDto[] | null;

  @ApiProperty({
    type: String,
    example: '100.000000',
    nullable: true,
    description:
      "Minimum insurance pay-in deposit. Null for non-trader invites. Until the invite is redeemed this is the global value; after redemption, the redeeming account's own value.",
  })
  insurancePayInMin: string | null;
}

export const toInviteDto = (invite: Invite, terms: InviteTerms): InviteDto => ({
  id: invite.id,
  telegramUsername: invite.telegramUsername,
  role: invite.role,
  merchantId: invite.merchantId ?? null,
  code: invite.code,
  status: inviteStatus(invite),
  expiresAt: invite.expiresAt,
  usedAt: invite.usedAt,
  usedBy: invite.usedBy ? toInviteAccountDto(invite.usedBy) : null,
  revokedAt: invite.revokedAt ?? null,
  revokedBy: invite.revokedBy ? toInviteAccountDto(invite.revokedBy) : null,
  createdBy: toInviteAccountDto(invite.createdBy),
  createdAt: invite.createdAt,
  rates: terms.rates,
  insurancePayInMin: terms.insurancePayInMin,
});
