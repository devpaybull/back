import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { MethodRate } from '../entities/method-rate.entity';
import { EffectiveGeneralRates } from '../types/effective-general-rates';
import { MethodPercent } from '../types/method-percent';
import { RateCandidate, RateDirection } from '../types/rate-candidate';
import { RateSubject } from '../types/rate-subject';
import { RateScope } from '../types/rate-scope.enum';
import {
  BaseMethodRate,
  RateAudit,
  SubjectMethodRates,
} from '../types/rate-set';
import { TransactionMethod } from '../types/transaction-method.enum';
import { bandsAreValid } from '../utils/bands-valid';
import { resolveRate } from '../utils/resolve-rate';
import { roundMoney } from '../utils/round-money';
import { RapiraRateProvider } from './rapira-rate.provider';

export interface MethodPercentQuery {
  scope: RateScope;
  method: TransactionMethod;
  amount: number;
  direction: RateDirection;
  individualEnabled: boolean;
  subjectUserId?: string | null;
  subjectMerchantId?: string | null;
}

@Injectable()
export class RateService {
  constructor(
    @InjectRepository(MethodRate)
    private readonly rates: Repository<MethodRate>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly rapira: RapiraRateProvider,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  getBaseSet(scope: RateScope): Promise<MethodRate[]> {
    return this.rates.find({
      where: {
        scope,
        subjectUserId: IsNull(),
        subjectMerchantId: IsNull(),
        fromAmount: IsNull(),
        toAmount: IsNull(),
      },
      order: { method: 'ASC' },
    });
  }

  getSubjectSet(
    scope: RateScope,
    subjectUserId: string,
  ): Promise<MethodRate[]> {
    return this.rates.find({
      where: { scope, subjectUserId },
      order: { method: 'ASC', fromAmount: 'ASC' },
    });
  }

  async getEffectiveGeneralRates(
    scope: RateScope,
    subjects: RateSubject[],
  ): Promise<EffectiveGeneralRates> {
    const toPercent = (row: MethodRate): MethodPercent => ({
      method: row.method,
      payInPercent: row.payInPercent,
      payOutPercent: row.payOutPercent,
    });
    const methodOrder = Object.values(TransactionMethod);
    const byMethodOrder = (one: MethodPercent, other: MethodPercent) =>
      methodOrder.indexOf(one.method) - methodOrder.indexOf(other.method);
    const base = (await this.getBaseSet(scope))
      .map(toPercent)
      .sort(byMethodOrder);
    const enabledIds = subjects
      .filter((subject) => subject.individualEnabled)
      .map((subject) => subject.userId);
    const individualRows = enabledIds.length
      ? await this.rates.find({
          where: {
            scope,
            subjectUserId: In(enabledIds),
            fromAmount: IsNull(),
            toAmount: IsNull(),
          },
        })
      : [];
    const bySubject = new Map<string, MethodPercent[]>();

    for (const subject of subjects) {
      const merged = new Map(base.map((entry) => [entry.method, entry]));

      if (subject.individualEnabled) {
        for (const row of individualRows) {
          if (row.subjectUserId === subject.userId) {
            merged.set(row.method, toPercent(row));
          }
        }
      }

      bySubject.set(subject.userId, [...merged.values()].sort(byMethodOrder));
    }

    return { base, bySubject };
  }

  async replaceBaseSet(
    scope: RateScope,
    entries: BaseMethodRate[],
    audit: RateAudit,
  ): Promise<MethodRate[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(MethodRate, {
        scope,
        subjectUserId: IsNull(),
        subjectMerchantId: IsNull(),
      });

      const rows = entries.map((entry) =>
        manager.create(MethodRate, {
          scope,
          method: entry.method,
          subjectUserId: null,
          subjectMerchantId: null,
          fromAmount: null,
          toAmount: null,
          payInPercent: entry.payInPercent,
          payOutPercent: entry.payOutPercent,
        }),
      );
      const saved = rows.length ? await manager.save(rows) : [];

      await this.audit.record(
        {
          actorUserId: audit.actorUserId,
          action: 'rates.updated',
          metadata: { scope },
        },
        manager,
      );

      return saved;
    });
  }

  async replaceSubjectSet(
    scope: RateScope,
    subjectUserId: string,
    entries: SubjectMethodRates[],
    audit: RateAudit,
  ): Promise<MethodRate[]> {
    for (const entry of entries) {
      if (!bandsAreValid(entry.bands)) {
        throw new BadRequestException('Overlapping or invalid rate bands');
      }
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.delete(MethodRate, { scope, subjectUserId });

      const rows: MethodRate[] = [];
      for (const entry of entries) {
        if (entry.general) {
          rows.push(
            manager.create(MethodRate, {
              scope,
              method: entry.method,
              subjectUserId,
              subjectMerchantId: null,
              fromAmount: null,
              toAmount: null,
              payInPercent: entry.general.payInPercent,
              payOutPercent: entry.general.payOutPercent,
            }),
          );
        }
        for (const band of entry.bands) {
          rows.push(
            manager.create(MethodRate, {
              scope,
              method: entry.method,
              subjectUserId,
              subjectMerchantId: null,
              fromAmount: band.fromAmount,
              toAmount: band.toAmount,
              payInPercent: band.payInPercent,
              payOutPercent: band.payOutPercent,
            }),
          );
        }
      }
      const saved = rows.length ? await manager.save(rows) : [];

      await this.audit.record(
        {
          actorUserId: audit.actorUserId,
          targetUserId: subjectUserId,
          action: 'rates.updated',
          metadata: { scope },
        },
        manager,
      );

      return saved;
    });
  }

  async getBaseRate(): Promise<number> {
    const fiatPerUsdt = await this.rapira.getFiatPerUsdt();
    const markup = this.config.get<number>('RATE_MARKUP', 0);

    return roundMoney(fiatPerUsdt * (1 + markup));
  }

  async resolveMethodPercent(query: MethodPercentQuery): Promise<number> {
    const rows = await this.rates.find({
      where: [
        {
          scope: query.scope,
          method: query.method,
          subjectUserId: IsNull(),
          subjectMerchantId: IsNull(),
        },
        ...(query.subjectUserId
          ? [
              {
                scope: query.scope,
                method: query.method,
                subjectUserId: query.subjectUserId,
              },
            ]
          : []),
        ...(query.subjectMerchantId
          ? [
              {
                scope: query.scope,
                method: query.method,
                subjectMerchantId: query.subjectMerchantId,
              },
            ]
          : []),
      ],
    });

    const candidates: RateCandidate[] = rows.map((row) => ({
      hasSubject: row.subjectUserId !== null || row.subjectMerchantId !== null,
      fromAmount: row.fromAmount ?? null,
      toAmount: row.toAmount ?? null,
      payInPercent: row.payInPercent,
      payOutPercent: row.payOutPercent,
    }));

    return resolveRate({
      candidates,
      amount: query.amount,
      individualEnabled: query.individualEnabled,
      direction: query.direction,
    });
  }
}
