import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import {
  canTransition,
  FINAL_STATUSES,
  isFinalStatus,
  startStatus,
} from '../utils/status-transitions';

describe('status transitions', () => {
  describe('startStatus', () => {
    it('pay-in starts active', () => {
      expect(startStatus(TransactionKind.PayIn)).toBe(TransactionStatus.Active);
    });

    it('pay-out starts pending', () => {
      expect(startStatus(TransactionKind.PayOut)).toBe(
        TransactionStatus.Pending,
      );
    });

    it('internal transfer starts active', () => {
      expect(startStatus(TransactionKind.InternalTransfer)).toBe(
        TransactionStatus.Active,
      );
    });
  });

  describe('isFinalStatus', () => {
    it('success, success_changed and canceled are final', () => {
      expect(FINAL_STATUSES).toEqual([
        TransactionStatus.Success,
        TransactionStatus.SuccessChanged,
        TransactionStatus.Canceled,
      ]);
      expect(isFinalStatus(TransactionStatus.Success)).toBe(true);
      expect(isFinalStatus(TransactionStatus.SuccessChanged)).toBe(true);
      expect(isFinalStatus(TransactionStatus.Canceled)).toBe(true);
    });

    it('active is not final', () => {
      expect(isFinalStatus(TransactionStatus.Active)).toBe(false);
    });
  });

  describe('pay-in graph', () => {
    it('allows the documented edges', () => {
      expect(
        canTransition(
          TransactionKind.PayIn,
          TransactionStatus.Active,
          TransactionStatus.Checking,
        ),
      ).toBe(true);
      expect(
        canTransition(
          TransactionKind.PayIn,
          TransactionStatus.CheckingManually,
          TransactionStatus.Dispute,
        ),
      ).toBe(true);
      expect(
        canTransition(
          TransactionKind.PayIn,
          TransactionStatus.ManualReview,
          TransactionStatus.SuccessChanged,
        ),
      ).toBe(true);
    });

    it('rejects edges that are not listed', () => {
      expect(
        canTransition(
          TransactionKind.PayIn,
          TransactionStatus.Active,
          TransactionStatus.SuccessChanged,
        ),
      ).toBe(false);
      expect(
        canTransition(
          TransactionKind.PayIn,
          TransactionStatus.Active,
          TransactionStatus.Pending,
        ),
      ).toBe(false);
    });

    it('has no outgoing edge from a final status', () => {
      expect(
        canTransition(
          TransactionKind.PayIn,
          TransactionStatus.Success,
          TransactionStatus.Canceled,
        ),
      ).toBe(false);
    });
  });

  describe('pay-out graph', () => {
    it('allows returning an active pay-out to the queue', () => {
      expect(
        canTransition(
          TransactionKind.PayOut,
          TransactionStatus.Active,
          TransactionStatus.Pending,
        ),
      ).toBe(true);
    });

    it('does not use the pay-in checking states', () => {
      expect(
        canTransition(
          TransactionKind.PayOut,
          TransactionStatus.Active,
          TransactionStatus.Checking,
        ),
      ).toBe(false);
    });
  });

  describe('internal transfer graph', () => {
    it('goes active to success or canceled only', () => {
      expect(
        canTransition(
          TransactionKind.InternalTransfer,
          TransactionStatus.Active,
          TransactionStatus.Success,
        ),
      ).toBe(true);
      expect(
        canTransition(
          TransactionKind.InternalTransfer,
          TransactionStatus.Active,
          TransactionStatus.Canceled,
        ),
      ).toBe(true);
      expect(
        canTransition(
          TransactionKind.InternalTransfer,
          TransactionStatus.Active,
          TransactionStatus.Dispute,
        ),
      ).toBe(false);
    });
  });
});
