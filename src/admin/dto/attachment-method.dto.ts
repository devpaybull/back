import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn } from 'class-validator';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';

export class AttachmentMethodDto {
  @ApiProperty({ enum: TRANSACTION_METHOD_CODES })
  @IsIn(TRANSACTION_METHOD_CODES)
  method: string;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}
