import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import { User } from '../../users/entities/user.entity';

export class InviteAccountDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;

  @ApiProperty({ enum: Role })
  role: Role;
}

export const toInviteAccountDto = (user: User): InviteAccountDto => ({
  id: user.id,
  login: user.email ?? user.telegramUsername,
  role: user.role,
});
