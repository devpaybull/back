import { CounterpartyHealth } from '../types/counterparty-health.enum';
import { counterpartyHealth } from '../utils/counterparty-health';

describe('counterpartyHealth', () => {
  it('is active for an enabled counterparty', () => {
    expect(counterpartyHealth({ enabled: true, blacklistedAt: null })).toBe(
      CounterpartyHealth.Active,
    );
  });

  it('is disabled for a disabled counterparty that is not blacklisted', () => {
    expect(counterpartyHealth({ enabled: false, blacklistedAt: null })).toBe(
      CounterpartyHealth.Disabled,
    );
  });

  it('is blacklisted when a blacklisting date is set', () => {
    expect(
      counterpartyHealth({ enabled: false, blacklistedAt: new Date() }),
    ).toBe(CounterpartyHealth.Blacklisted);
  });

  it('prefers blacklisted over enabled', () => {
    expect(
      counterpartyHealth({ enabled: true, blacklistedAt: new Date() }),
    ).toBe(CounterpartyHealth.Blacklisted);
  });
});
