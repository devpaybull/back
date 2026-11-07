import { ApiProperty } from '@nestjs/swagger';

export class TraderDealCountersDto {
  @ApiProperty()
  all: number;

  @ApiProperty({ description: 'Активные' })
  active: number;

  @ApiProperty({ description: 'Апелляция: dispute + manual_review' })
  dispute: number;

  @ApiProperty({ description: 'Проверка чека' })
  checking: number;

  @ApiProperty({ description: 'Ручная проверка' })
  checking_manually: number;

  @ApiProperty({ description: 'Пересчитанная' })
  success_changed: number;

  @ApiProperty({ description: 'Завершенные' })
  success: number;

  @ApiProperty({ description: 'Отмененные' })
  canceled: number;
}
