import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';

export class ListCounterpartyRequisitesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BankDetailsType,
    description: 'The channel chosen in the modal',
  })
  @IsOptional()
  @IsEnum(BankDetailsType)
  type?: BankDetailsType;
}
