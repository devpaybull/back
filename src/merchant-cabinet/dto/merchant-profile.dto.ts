import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import { MerchantRefDto } from './merchant-account.dto';

export class MerchantProfileUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({
    description: 'the account’s registration — «Дата регистрации»',
  })
  createdAt: Date;
}

export class MerchantProfileDto {
  @ApiProperty({ type: MerchantRefDto })
  merchant: MerchantRefDto;

  @ApiProperty({ type: MerchantProfileUserDto })
  user: MerchantProfileUserDto;
}
