import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Role } from '../../common/enums/role.enum';
import { InviteSortField } from '../../invites/types/invite-sort-field';
import { InviteStatus } from '../../invites/types/invite-status';

export class ListInvitesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: InviteStatus })
  @IsOptional()
  @IsEnum(InviteStatus)
  status?: InviteStatus;

  @ApiPropertyOptional({
    enum: InviteSortField,
    default: InviteSortField.CreatedAt,
  })
  @IsEnum(InviteSortField)
  sortBy: InviteSortField = InviteSortField.CreatedAt;
}
