import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
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

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty()
  createdAt: Date;
}

export const toUserDto = (user: User): UserDto => ({
  id: user.id,
  login: user.email ?? user.telegramUsername,
  email: user.email,
  telegramUsername: user.telegramUsername,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
});
