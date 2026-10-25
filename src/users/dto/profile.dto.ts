import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import { loginOf } from '../../common/utils/login-of';
import { User } from '../entities/user.entity';
import { UserStatus } from '../types/user-status.enum';

export class ProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;

  @ApiPropertyOptional({ nullable: true })
  email: string;

  @ApiProperty({
    description:
      'False while a mailed code is outstanding: the address is written at once and proved afterwards',
  })
  emailVerified: boolean;

  @ApiPropertyOptional({ nullable: true })
  telegramUsername: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty()
  createdAt: Date;
}

export const toProfileDto = (user: User): ProfileDto => ({
  id: user.id,
  login: loginOf(user),
  email: user.email,
  emailVerified: user.emailVerified,
  telegramUsername: user.telegramUsername,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
});
