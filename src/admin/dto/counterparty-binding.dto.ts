import { ApiProperty } from '@nestjs/swagger';
import { CounterpartyBindingType } from '../../counterparties/types/counterparty-binding-type.enum';
import { CounterpartyRequisiteDto } from './counterparty-requisite.dto';

export class CounterpartyBindingDto {
  @ApiProperty({ type: CounterpartyRequisiteDto })
  requisite: CounterpartyRequisiteDto;

  @ApiProperty({ enum: CounterpartyBindingType })
  bindingType: CounterpartyBindingType;

  @ApiProperty()
  boundAt: Date;
}
