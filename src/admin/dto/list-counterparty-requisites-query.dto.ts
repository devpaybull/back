import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TransactionType } from '../../common/enums/transaction-type.enum';

export class ListCounterpartyRequisitesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: TransactionType,
    description: 'The channel chosen in the modal',
  })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;
}
