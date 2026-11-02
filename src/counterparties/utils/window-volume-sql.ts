import { VolumeWindow } from '../types/volume-window';

export function windowVolumeSql(
  window: VolumeWindow,
  column: 'paidAmount' | 'paidCount',
): string {
  return `COALESCE((SELECT SUM(volume."${column}") FROM counterparty_daily_volumes volume WHERE volume."counterpartyId" = counterparty.id AND volume.day >= :since${window}), 0)`;
}
