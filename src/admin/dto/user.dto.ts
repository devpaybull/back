import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import { loginOf } from '../../common/utils/login-of';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';

export class UserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;

  @ApiPropertyOptional({ nullable: true })
  email: string;

  @ApiPropertyOptional({ nullable: true })
  telegramUsername: string;

  @ApiPropertyOptional({ nullable: true, example: '123456789' })
  telegramId: string | null;

  @ApiPropertyOptional({ nullable: true })
  telegramGroups: string | null;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty()
  createdAt: Date;
}

export const toUserDto = (user: User): UserDto => ({
  id: user.id,
  login: loginOf(user),
  email: user.email,
  telegramUsername: user.telegramUsername,
  telegramId: user.telegramId ?? null,
  telegramGroups: user.telegramGroups ?? null,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
});
