import { ApiProperty } from '@nestjs/swagger';

export class CounterpartyFunnelDto {
  @ApiProperty({
    nullable: true,
    description: 'Requests for a deal; null until the merchant API exists',
  })
  requests: number | null;

  @ApiProperty()
  deals: number;

  @ApiProperty()
  paid: number;
}
