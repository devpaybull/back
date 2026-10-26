import { UsdtTransferEvent } from './usdt-transfer-event';

export type UsdtTransferInspectionStatus =
  'not_found' | 'pending' | 'failed' | 'not_usdt' | 'confirmed';

export interface UsdtTransferInspection {
  status: UsdtTransferInspectionStatus;
  transfers: UsdtTransferEvent[];
}
