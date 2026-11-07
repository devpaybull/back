import { ApiProperty } from '@nestjs/swagger';
import { BankDetailTag } from '../entities/bank-detail-tag.entity';

export class BankDetailTagDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  createdAt: Date;
}

export const toBankDetailTagDto = (tag: BankDetailTag): BankDetailTagDto => ({
  id: tag.id,
  name: tag.name,
  createdAt: tag.createdAt,
});
