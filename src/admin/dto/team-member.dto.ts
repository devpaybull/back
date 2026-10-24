import { ApiProperty } from '@nestjs/swagger';

export class TeamMemberDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;
}
