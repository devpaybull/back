import { ApiProperty } from '@nestjs/swagger';

export class CardLeadShareDto {
  @ApiProperty({ format: 'uuid' })
  leadUserId: string;

  @ApiProperty({ nullable: true })
  login: string | null;

  @ApiProperty({ example: 1 })
  percent: number;

  @ApiProperty({ type: String, example: '0.200000' })
  amount: string;
}
