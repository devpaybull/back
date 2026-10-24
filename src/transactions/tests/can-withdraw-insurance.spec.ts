import { canWithdrawInsurance } from '../utils/can-withdraw-insurance';

describe('canWithdrawInsurance', () => {
  const now = new Date('2026-09-02T00:00:00Z');
  const delayDays = 14;

  it('allows withdrawal when no deal was ever accepted', () => {
    expect(canWithdrawInsurance(null, now, delayDays)).toBe(true);
  });

  it('blocks withdrawal within the delay window', () => {
    const lastDeal = new Date('2026-08-25T00:00:00Z');
    expect(canWithdrawInsurance(lastDeal, now, delayDays)).toBe(false);
  });

  it('allows withdrawal once the delay has fully elapsed', () => {
    const lastDeal = new Date('2026-08-19T00:00:00Z');
    expect(canWithdrawInsurance(lastDeal, now, delayDays)).toBe(true);
  });

  it('treats exactly the delay boundary as eligible', () => {
    const lastDeal = new Date('2026-08-19T00:00:00Z');
    expect(canWithdrawInsurance(lastDeal, now, delayDays)).toBe(true);
  });
});
