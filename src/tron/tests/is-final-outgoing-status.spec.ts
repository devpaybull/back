import { OutgoingTransferStatus } from '../types/outgoing-transfer-status.enum';
import { isFinalOutgoingStatus } from '../utils/is-final-outgoing-status';

describe('isFinalOutgoingStatus', () => {
  it.each([
    OutgoingTransferStatus.Confirmed,
    OutgoingTransferStatus.Failed,
    OutgoingTransferStatus.Expired,
  ])('%s is final', (status) => {
    expect(isFinalOutgoingStatus(status)).toBe(true);
  });

  it.each([
    OutgoingTransferStatus.Building,
    OutgoingTransferStatus.Signed,
    OutgoingTransferStatus.Broadcast,
  ])('%s is not', (status) => {
    expect(isFinalOutgoingStatus(status)).toBe(false);
  });
});
