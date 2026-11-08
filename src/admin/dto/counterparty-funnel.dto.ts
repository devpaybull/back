import { ApiProperty } from '@nestjs/swagger';

export class CounterpartyFunnelDto {
  @ApiProperty({
    description:
      'Deal-creation requests that reached the counterparty lookup — the counter without a method, counted in the request log (Postgres and the archive) with one',
  })
  requests: number;

  @ApiProperty()
  deals: number;

  @ApiProperty()
  paid: number;
}
