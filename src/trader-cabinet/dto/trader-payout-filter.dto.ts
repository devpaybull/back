import { PickType } from '@nestjs/swagger';
import { TraderDealFilterDto } from './trader-deal-filter.dto';

export class TraderPayoutFilterDto extends PickType(TraderDealFilterDto, [
  'status',
  'period',
  'createdFrom',
  'createdTo',
  'method',
  'amountFrom',
  'amountTo',
  'merchantGroupId',
  'search',
] as const) {}
