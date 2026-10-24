import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Role } from '../../common/enums/role.enum';
import { UserSortField } from '../../users/types/user-sort-field.enum';
import { UserStatus } from '../../users/types/user-status.enum';

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role, isArray: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || Array.isArray(value) ? value : [value],
  )
  @IsEnum(Role, { each: true })
  role?: Role[];

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    enum: UserSortField,
    default: UserSortField.CreatedAt,
  })
  @IsEnum(UserSortField)
  sortBy: UserSortField = UserSortField.CreatedAt;
}
