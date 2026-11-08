import { CounterpartyDayRequests } from '../../counterparties/types/counterparty-day-requests';
import { CounterpartyRequestTotals } from '../../counterparties/types/counterparty-request-totals';
import { CounterpartyRequestCounts } from '../types/counterparty-request-counts';

export class CounterpartyRequestTally {
  private readonly days = new Map<string, CounterpartyDayRequests>();
  private readonly totals = new Map<number, CounterpartyRequestTotals>();

  constructor(from?: CounterpartyRequestCounts) {
    for (const day of from?.days ?? []) {
      this.days.set(`${day.counterpartyId}:${day.day}`, { ...day });
    }
    for (const total of from?.totals ?? []) {
      this.totals.set(total.counterpartyId, { ...total });
    }
  }

  add(counterpartyId: number, day: string, count: number, last: Date): void {
    const dayKey = `${counterpartyId}:${day}`;
    const bucket = this.days.get(dayKey);
    const total = this.totals.get(counterpartyId);

    this.days.set(dayKey, {
      counterpartyId,
      day,
      requestCount: (bucket?.requestCount ?? 0) + count,
    });
    this.totals.set(counterpartyId, {
      counterpartyId,
      requestCount: (total?.requestCount ?? 0) + count,
      lastRequestAt:
        total?.lastRequestAt && total.lastRequestAt > last
          ? total.lastRequestAt
          : last,
    });
  }

  result(): CounterpartyRequestCounts {
    return {
      totals: [...this.totals.values()],
      days: [...this.days.values()],
    };
  }
}
