import { ApiProperty } from '@nestjs/swagger';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';

export class CounterpartyDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  merchantId: string;

  @ApiProperty()
  externalId: string;

  @ApiProperty({ nullable: true })
  name: string;

  @ApiProperty({ nullable: true })
  contact: string;

  @ApiProperty({ nullable: true, type: Object })
  payload: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;
}

export const toCounterpartyDto = (row: Counterparty): CounterpartyDto => ({
  id: row.id,
  merchantId: row.merchantId,
  externalId: row.externalId,
  name: row.name,
  contact: row.contact,
  payload: row.payload,
  createdAt: row.createdAt,
});
