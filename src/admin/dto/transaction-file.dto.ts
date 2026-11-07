import { ApiProperty } from '@nestjs/swagger';
import { TransactionFileKind } from '../../transactions/types/transaction-file-kind.enum';

export class TransactionFileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: TransactionFileKind })
  kind: TransactionFileKind;

  @ApiProperty()
  name: string;

  @ApiProperty()
  mime: string;

  @ApiProperty()
  size: number;

  @ApiProperty({ format: 'uuid' })
  uploadedByUserId: string;

  @ApiProperty()
  createdAt: Date;
}
