import { ApiProperty } from '@nestjs/swagger';

export class TransactionMethodCountersDto {
  @ApiProperty({ example: 32 })
  all: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { sbp: 20, card: 12 },
    description:
      'Every method of the registry the kind works in, zeros included; the filters apply except method',
  })
  byMethod: Record<string, number>;
}
