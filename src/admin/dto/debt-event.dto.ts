import { ApiProperty } from '@nestjs/swagger';
import { DebtEvent } from '../../debts/entities/debt-event.entity';
import { DebtEventType } from '../../debts/types/debt-event-type.enum';
import { InviteAccountDto, toInviteAccountDto } from './invite-account.dto';

export class DebtEventDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  debtId: number;

  @ApiProperty({ enum: DebtEventType })
  type: DebtEventType;

  @ApiProperty({ description: 'USDT issued or withheld' })
  amount: number;

  @ApiProperty({
    type: InviteAccountDto,
    nullable: true,
    description: 'null for an automatic write-off',
  })
  actor: InviteAccountDto | null;

  @ApiProperty({ nullable: true, type: Number })
  balanceOperationId: number | null;

  @ApiProperty()
  createdAt: Date;
}

export const toDebtEventDto = (event: DebtEvent): DebtEventDto => ({
  id: event.id,
  debtId: event.debtId,
  type: event.type,
  amount: event.amount,
  actor: event.actor ? toInviteAccountDto(event.actor) : null,
  balanceOperationId: event.balanceOperationId ?? null,
  createdAt: event.createdAt,
});
