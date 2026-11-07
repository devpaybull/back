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

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null: uploaded by the merchant through /v1',
  })
  uploadedByUserId: string | null;

  @ApiProperty()
  createdAt: Date;
}
