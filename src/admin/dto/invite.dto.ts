import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import { Invite } from '../../invites/entities/invite.entity';
import { InviteStatus, inviteStatus } from '../../invites/types/invite-status';
import { InviteAccountDto, toInviteAccountDto } from './invite-account.dto';

export class InviteDto {
  @ApiProperty()
  id: number;

  @ApiPropertyOptional({ nullable: true })
  email: string;

  @ApiPropertyOptional({ nullable: true })
  telegramUsername: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty()
  code: string;

  @ApiProperty({ enum: InviteStatus })
  status: InviteStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiPropertyOptional({ nullable: true })
  usedAt: Date;

  @ApiPropertyOptional({ type: InviteAccountDto, nullable: true })
  usedBy: InviteAccountDto;

  @ApiPropertyOptional({ nullable: true })
  revokedAt: Date;

  @ApiPropertyOptional({ type: InviteAccountDto, nullable: true })
  revokedBy: InviteAccountDto;

  @ApiProperty({ type: InviteAccountDto })
  createdBy: InviteAccountDto;

  @ApiProperty()
  createdAt: Date;
}

export const toInviteDto = (invite: Invite): InviteDto => ({
  id: invite.id,
  email: invite.email,
  telegramUsername: invite.telegramUsername,
  role: invite.role,
  code: invite.code,
  status: inviteStatus(invite),
  expiresAt: invite.expiresAt,
  usedAt: invite.usedAt,
  usedBy: invite.usedBy ? toInviteAccountDto(invite.usedBy) : null,
  revokedAt: invite.revokedAt ?? null,
  revokedBy: invite.revokedBy ? toInviteAccountDto(invite.revokedBy) : null,
  createdBy: toInviteAccountDto(invite.createdBy),
  createdAt: invite.createdAt,
});
