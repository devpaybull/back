import { NotFoundException } from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { TransactionCardService } from '../services/transaction-card.service';
import { AdminDealAction } from '../types/admin-deal-action.enum';
import { DisputeStatus } from '../types/dispute-status.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const TRADER = uuidOf(1);
const context = {
  liveDispute: false,
  openDispute: false,
  hasCallbackUrl: true,
  superadmin: true,
};
const deal = (
  kind: TransactionKind,
  status: TransactionStatus,
  traderUserId: string | null = TRADER,
) => ({ kind, status, traderUserId });

const build = (found: object | null, disputes: object[] = []) => {
  const manager = {
    findOne: jest.fn(async () => found),
    find: jest.fn(async (entity: unknown) =>
      entity === TransactionDispute
        ? disputes
        : entity === TransactionStatusEvent
          ? [{ id: 1 }]
          : entity === TransactionLeadShare
            ? [{ id: 2 }]
            : [],
    ),
  };
  const actions = { hasCallbackUrl: jest.fn(async () => true) };

  return new TransactionCardService(
    { manager } as never,
    { listOf: jest.fn(async () => [{ id: 'f' }]) } as never,
    actions as never,
  );
};

describe('TransactionCardService', () => {
  const service = build(null);

  it('an open pay-in can be closed and disputed', () => {
    expect(
      service.actionsOf(
        deal(TransactionKind.PayIn, TransactionStatus.Active),
        context,
      ),
    ).toEqual([
      AdminDealAction.Close,
      AdminDealAction.OpenDispute,
      AdminDealAction.SendCallback,
    ]);
  });

  it('a settled deal: the money actions only for a superadmin', () => {
    const settled = deal(TransactionKind.PayIn, TransactionStatus.Success);

    expect(service.actionsOf(settled, context)).toEqual([
      AdminDealAction.ChangeAmount,
      AdminDealAction.CancelSettled,
      AdminDealAction.OpenDispute,
      AdminDealAction.SendCallback,
    ]);
    expect(
      service.actionsOf(settled, { ...context, superadmin: false }),
    ).toEqual([AdminDealAction.OpenDispute, AdminDealAction.SendCallback]);
  });

  it('a canceled pay-in can be restored; a canceled pay-out reassigned or disputed', () => {
    expect(
      service.actionsOf(
        deal(TransactionKind.PayIn, TransactionStatus.Canceled),
        context,
      ),
    ).toContain(AdminDealAction.Restore);
    expect(
      service.actionsOf(
        deal(TransactionKind.PayOut, TransactionStatus.Canceled),
        context,
      ),
    ).toEqual([
      AdminDealAction.OpenDispute,
      AdminDealAction.SendCallback,
      AdminDealAction.AssignTrader,
    ]);
  });

  it('a pool pay-out: cancel and assign, no dispute without a trader', () => {
    expect(
      service.actionsOf(
        deal(TransactionKind.PayOut, TransactionStatus.Pending, null),
        { ...context, hasCallbackUrl: false },
      ),
    ).toEqual([AdminDealAction.CancelPayout, AdminDealAction.AssignTrader]);
  });

  it('a live dispute leaves only the callback', () => {
    expect(
      service.actionsOf(
        deal(TransactionKind.PayIn, TransactionStatus.Success),
        { ...context, liveDispute: true, openDispute: true },
      ),
    ).toEqual([AdminDealAction.SendCallback]);
  });

  it('a deal already in dispute cannot get another', () => {
    expect(
      service.actionsOf(
        deal(TransactionKind.PayIn, TransactionStatus.ManualReview),
        context,
      ),
    ).not.toContain(AdminDealAction.OpenDispute);
  });

  it('a deferred dispute still lets an open pay-in be closed: the success ends it', async () => {
    expect(
      service.actionsOf(deal(TransactionKind.PayIn, TransactionStatus.Active), {
        ...context,
        liveDispute: true,
      }),
    ).toEqual([AdminDealAction.Close, AdminDealAction.SendCallback]);
  });

  it('collects the card and sees a deferred dispute as live', async () => {
    const card = await build(
      { id: 'd', ...deal(TransactionKind.PayIn, TransactionStatus.Active) },
      [{ status: DisputeStatus.Deferred }],
    ).cardOf('d', true);

    expect(card.events).toEqual([{ id: 1 }]);
    expect(card.leadShares).toEqual([{ id: 2 }]);
    expect(card.files).toEqual([{ id: 'f' }]);
    expect(card.actions).toEqual([
      AdminDealAction.Close,
      AdminDealAction.SendCallback,
    ]);
  });

  it('404 for an unknown deal', async () => {
    await expect(build(null).cardOf('d', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
