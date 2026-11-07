import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequisiteHistoryReadStateDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'When the history was last marked read; null — never',
  })
  lastReadAt: Date;

  @ApiProperty({ description: 'History rows newer than lastReadAt' })
  unreadCount: number;
}
