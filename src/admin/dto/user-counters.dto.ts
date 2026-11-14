import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';

export class UserRoleCountsDto implements Record<Role, number> {
  @ApiProperty()
  trader: number;

  @ApiProperty()
  lead_trader: number;

  @ApiProperty()
  merchant: number;

  @ApiProperty()
  merchant_support: number;

  @ApiProperty()
  merchant_agent: number;

  @ApiProperty()
  cascade: number;

  @ApiProperty()
  admin: number;

  @ApiProperty()
  superadmin: number;
}

export class UserCountersDto {
  @ApiProperty({ description: '«Все» — every account under the filters' })
  all: number;

  @ApiProperty({
    type: UserRoleCountsDto,
    description: 'Every role, zero included, under the same filters',
  })
  byRole: UserRoleCountsDto;
}
