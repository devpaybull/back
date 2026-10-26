import { OutgoingTransferStatus } from '../types/outgoing-transfer-status.enum';

const FINAL: readonly OutgoingTransferStatus[] = [
  OutgoingTransferStatus.Confirmed,
  OutgoingTransferStatus.Failed,
  OutgoingTransferStatus.Expired,
];

export const isFinalOutgoingStatus = (
  status: OutgoingTransferStatus,
): boolean => FINAL.includes(status);
