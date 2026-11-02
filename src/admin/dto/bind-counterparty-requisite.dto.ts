import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { CounterpartyBindingType } from '../../counterparties/types/counterparty-binding-type.enum';

export class BindCounterpartyRequisiteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  bankDetailsId: string;

  @ApiProperty({
    enum: CounterpartyBindingType,
    description: 'Must include the requisite’s own channel',
  })
  @IsEnum(CounterpartyBindingType)
  bindingType: CounterpartyBindingType;
}
