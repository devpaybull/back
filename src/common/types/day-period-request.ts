import { DayPeriod } from '../enums/day-period.enum';

export interface DayPeriodRequest {
  period?: DayPeriod;
  periodFrom?: string;
  periodTo?: string;
}
