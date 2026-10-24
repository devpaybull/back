import { ApiProperty } from '@nestjs/swagger';
import { loginOf } from '../../common/utils/login-of';
import { User } from '../../users/entities/user.entity';

export class DebtorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;

  @ApiProperty({ nullable: true, type: String })
  telegramUsername: string | null;
}

export const toDebtorDto = (user: User): DebtorDto => ({
  id: user.id,
  login: loginOf(user),
  telegramUsername: user.telegramUsername ?? null,
});
