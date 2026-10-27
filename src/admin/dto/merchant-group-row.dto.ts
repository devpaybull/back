import { ApiProperty } from '@nestjs/swagger';
import { MerchantMethodsDto } from './merchant-methods.dto';
import { MerchantRowDto } from './merchant-row.dto';

export class MerchantGroupRowDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({
    description: 'true when at least one merchant of the group is',
  })
  active: boolean;

  @ApiProperty({
    description: 'true when at least one merchant of the group is',
  })
  exclusiveTopUp: boolean;

  @ApiProperty({
    type: String,
    example: '100001.000000',
    description: 'the sum of every merchant of the group',
  })
  balance: string;

  @ApiProperty({
    type: MerchantMethodsDto,
    description: 'a method is on when it is on for at least one merchant',
  })
  methods: MerchantMethodsDto;

  @ApiProperty({
    type: [MerchantRowDto],
    description: 'the merchants of the group that match the filters',
  })
  merchants: MerchantRowDto[];

  @ApiProperty()
  createdAt: Date;
}
