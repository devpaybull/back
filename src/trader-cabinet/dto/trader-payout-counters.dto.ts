import { ApiProperty } from '@nestjs/swagger';

export class TraderPayoutCountersDto {
  @ApiProperty()
  all: number;

  @ApiProperty({ description: 'В работе' })
  active: number;

  @ApiProperty({ description: 'На проверке' })
  checking: number;

  @ApiProperty({ description: 'Апелляция: dispute + manual_review' })
  dispute: number;

  @ApiProperty({ description: 'Завершенные: success + success_changed' })
  completed: number;

  @ApiProperty({ description: 'Отмененные' })
  canceled: number;
}
