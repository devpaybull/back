import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { VolumeWindow } from '../types/volume-window';

export const VOLUME_WINDOWS: readonly VolumeWindow[] = [7, 30, 60, 90];

export function windowStartDays(
  today: string,
): Record<`since${VolumeWindow}`, string> {
  return {
    since7: addCalendarDays(today, -6),
    since30: addCalendarDays(today, -29),
    since60: addCalendarDays(today, -59),
    since90: addCalendarDays(today, -89),
  };
}
