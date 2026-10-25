import { ApiProperty } from '@nestjs/swagger';
import { formatCrypto } from '../../common/utils/format-crypto';
import { Debt } from '../../debts/entities/debt.entity';
import { DebtorDto, toDebtorDto } from './debtor.dto';
import { InviteAccountDto, toInviteAccountDto } from './invite-account.dto';

export class DebtDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ type: DebtorDto })
  user: DebtorDto;

  @ApiProperty({ type: InviteAccountDto })
  issuedBy: InviteAccountDto;

  @ApiProperty({
    type: String,
    example: '100.000000',
    description: 'USDT issued',
  })
  amount: string;

  @ApiProperty({
    type: String,
    example: '100.000000',
    description: 'USDT still owed',
  })
  remaining: string;

  @ApiProperty({ description: 'true once nothing remains' })
  repaid: boolean;

  @ApiProperty({ nullable: true, type: String })
  comment: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  autoWriteOffAt: Date | null;

  @ApiProperty()
  autoWriteOffPaused: boolean;

  @ApiProperty()
  createdAt: Date;
}

export const toDebtDto = (debt: Debt): DebtDto => ({
  id: debt.id,
  user: toDebtorDto(debt.user),
  issuedBy: toInviteAccountDto(debt.issuedBy),
  amount: formatCrypto(debt.amount),
  remaining: formatCrypto(debt.remaining),
  repaid: debt.remaining.lte(0),
  comment: debt.comment ?? null,
  autoWriteOffAt: debt.autoWriteOffAt ?? null,
  autoWriteOffPaused: debt.autoWriteOffPaused,
  createdAt: debt.createdAt,
});
