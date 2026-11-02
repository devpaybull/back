import { ApiProperty } from '@nestjs/swagger';
import { loginOf } from '../../common/utils/login-of';
import { User } from '../../users/entities/user.entity';

export class CounterpartyTraderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;

  @ApiProperty({ nullable: true })
  email: string | null;
}

export const toCounterpartyTraderDto = (user: User): CounterpartyTraderDto => ({
  id: user.id,
  login: loginOf(user),
  email: user.email ?? null,
});
