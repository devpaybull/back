import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { BanksService } from '../../banks/banks.service';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { LeadRate } from '../entities/lead-rate.entity';
import { MethodRate } from '../entities/method-rate.entity';
import { DealLeadPercent } from '../types/deal-computation';
import { EffectiveGeneralRates } from '../types/effective-general-rates';
import { LeadPercentQuery } from '../types/lead-percent-query';
import { MethodPercent } from '../types/method-percent';
import { MethodPercentQuery } from '../types/method-percent-query';
import { RateCandidate } from '../types/rate-candidate';
import { RateKind } from '../types/rate-kind.enum';
import { RateSubject } from '../types/rate-subject';
import { RateScope } from '../types/rate-scope.enum';
import {
  BaseMethodRate,
  LeadRateAudit,
  RateAudit,
  SubjectMethodRates,
} from '../types/rate-set';
import { TransactionMethodDefinition } from '../types/transaction-method-definition';
import { bandsAreValid } from '../utils/bands-valid';
import { findTransactionMethod } from '../utils/find-transaction-method';
import { resolveRate } from '../utils/resolve-rate';
import { roundMoney } from '../utils/round-money';
import { TRANSACTION_METHOD_CODES } from '../utils/transaction-methods';
import { RapiraRateProvider } from './rapira-rate.provider';

const knownMethod = (code: string): TransactionMethodDefinition => {
  const method = findTransactionMethod(code);

  if (!method) throw new BadRequestException(`Unknown method ${code}`);

  return method;
};

const assertMethodsUnique = (entries: { method: string }[]): void => {
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.method)) {
      throw new BadRequestException(
        `Method ${entry.method} appears more than once in the set`,
      );
    }
    seen.add(entry.method);
  }
};

const lockRateSet = async (
  manager: EntityManager,
  key: string,
): Promise<void> => {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
};

const declarationRank = (code: string): number => {
  const index = TRANSACTION_METHOD_CODES.indexOf(code);

  return index === -1 ? TRANSACTION_METHOD_CODES.length : index;
};

@Injectable()
export class RateService {
  constructor(
    @InjectRepository(MethodRate)
    private readonly rates: Repository<MethodRate>,
    @InjectRepository(LeadRate)
    private readonly leadRates: Repository<LeadRate>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly rapira: RapiraRateProvider,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly banks: BanksService,
  ) {}

  getBaseSet(scope: RateScope): Promise<MethodRate[]> {
    return this.rates.find({
      where: {
        scope,
        subjectUserId: IsNull(),
        subjectMerchantId: IsNull(),
        fromAmount: IsNull(),
        toAmount: IsNull(),
        bankId: IsNull(),
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
      order: { method: 'ASC', bankId: 'ASC', fromAmount: 'ASC' },
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
    const byMethodOrder = (one: MethodPercent, other: MethodPercent) =>
      declarationRank(one.method) - declarationRank(other.method);
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
            bankId: IsNull(),
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
    for (const entry of entries) knownMethod(entry.method);
    assertMethodsUnique(entries);

    return this.dataSource.transaction(async (manager) => {
      await lockRateSet(manager, `method_rates:${scope}:base`);
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
          bankId: null,
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
    await this.assertSubjectSetFits(entries);

    return this.dataSource.transaction(async (manager) => {
      await lockRateSet(manager, `method_rates:${scope}:${subjectUserId}`);
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
              bankId: null,
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
              bankId: null,
              fromAmount: band.fromAmount,
              toAmount: band.toAmount,
              payInPercent: band.payInPercent,
              payOutPercent: band.payOutPercent,
            }),
          );
        }
        for (const bank of entry.banks) {
          rows.push(
            manager.create(MethodRate, {
              scope,
              method: entry.method,
              subjectUserId,
              subjectMerchantId: null,
              bankId: bank.bankId,
              fromAmount: null,
              toAmount: null,
              payInPercent: bank.payInPercent,
              payOutPercent: bank.payOutPercent,
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

  async getLeadSet(traderLeadIds: number[]): Promise<LeadRate[]> {
    if (traderLeadIds.length === 0) return [];

    return this.leadRates.find({
      where: { traderLeadId: In(traderLeadIds) },
      order: { method: 'ASC', bankId: 'ASC', fromAmount: 'ASC' },
    });
  }

  async replaceLeadSet(
    links: TraderLead[],
    entries: SubjectMethodRates[],
    audit: LeadRateAudit,
  ): Promise<LeadRate[]> {
    await this.assertSubjectSetFits(entries);

    const linkOf = (entry: SubjectMethodRates): TraderLead => {
      const { currency } = knownMethod(entry.method);
      const link = links.find(
        (candidate) => candidate.currency?.isocode === currency,
      );

      if (!link) {
        throw new BadRequestException(
          `Method ${entry.method} is in ${currency}, and the lead has no ${currency} assignment with this trader`,
        );
      }

      return link;
    };
    const placed = entries.map((entry) => ({ entry, link: linkOf(entry) }));

    return this.dataSource.transaction(async (manager) => {
      await lockRateSet(
        manager,
        `lead_rates:${audit.traderUserId}:${audit.leadUserId}`,
      );
      if (links.length) {
        await manager.delete(LeadRate, {
          traderLeadId: In(links.map((link) => link.id)),
        });
      }

      const rows: LeadRate[] = [];
      for (const { entry, link } of placed) {
        const row = (values: Partial<LeadRate>) =>
          manager.create(LeadRate, {
            traderLeadId: link.id,
            method: entry.method,
            bankId: null,
            fromAmount: null,
            toAmount: null,
            ...values,
          });

        if (entry.general) {
          rows.push(
            row({
              payInPercent: entry.general.payInPercent,
              payOutPercent: entry.general.payOutPercent,
            }),
          );
        }
        for (const band of entry.bands) {
          rows.push(
            row({
              fromAmount: band.fromAmount,
              toAmount: band.toAmount,
              payInPercent: band.payInPercent,
              payOutPercent: band.payOutPercent,
            }),
          );
        }
        for (const bank of entry.banks) {
          rows.push(
            row({
              bankId: bank.bankId,
              payInPercent: bank.payInPercent,
              payOutPercent: bank.payOutPercent,
            }),
          );
        }
      }
      const saved = rows.length ? await manager.save(rows) : [];

      await this.audit.record(
        {
          actorUserId: audit.actorUserId,
          targetUserId: audit.traderUserId,
          action: 'lead_rates.updated',
          metadata: { leadUserId: audit.leadUserId },
        },
        manager,
      );

      return saved;
    });
  }

  async resolveLeadPercents(
    query: LeadPercentQuery,
  ): Promise<DealLeadPercent[]> {
    const method = knownMethod(query.method);
    const links = query.links.filter(
      (link) => link.currency?.isocode === method.currency,
    );

    if (links.length === 0) return [];

    const rows = await this.leadRates.find({
      where: {
        traderLeadId: In(links.map((link) => link.id)),
        method: query.method,
      },
    });

    return links.map((link) => {
      const currencyGeneral: RateCandidate = {
        hasSubject: false,
        fromAmount: null,
        toAmount: null,
        bankId: null,
        payInPercent: link.payInPercent,
        payOutPercent: link.payOutPercent,
      };
      const detail: RateCandidate[] = rows
        .filter((row) => row.traderLeadId === link.id)
        .map((row) => ({
          hasSubject: true,
          fromAmount: row.fromAmount ?? null,
          toAmount: row.toAmount ?? null,
          bankId: row.bankId ?? null,
          payInPercent: row.payInPercent,
          payOutPercent: row.payOutPercent,
        }));

      return {
        leadUserId: link.leadUserId,
        percent: resolveRate({
          candidates: [...detail, currencyGeneral],
          amount: query.amount,
          bankId: query.bankId ?? null,
          rateKind: method.rateKind,
          individualEnabled: true,
          direction: query.direction,
        }),
      };
    });
  }

  async getBaseRate(): Promise<number> {
    const fiatPerUsdt = await this.rapira.getFiatPerUsdt();
    const markup = this.config.get<number>('RATE_MARKUP', 0);

    return roundMoney(fiatPerUsdt * (1 + markup));
  }

  async resolveMethodPercent(query: MethodPercentQuery): Promise<number> {
    const method = knownMethod(query.method);
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
      bankId: row.bankId ?? null,
      payInPercent: row.payInPercent,
      payOutPercent: row.payOutPercent,
    }));

    return resolveRate({
      candidates,
      amount: query.amount,
      bankId: query.bankId ?? null,
      rateKind: method.rateKind,
      individualEnabled: query.individualEnabled,
      direction: query.direction,
    });
  }

  private async assertSubjectSetFits(
    entries: SubjectMethodRates[],
  ): Promise<void> {
    const bankIds: number[] = [];

    for (const entry of entries) knownMethod(entry.method);
    assertMethodsUnique(entries);

    for (const entry of entries) {
      const method = knownMethod(entry.method);

      if (method.rateKind === RateKind.ByAmount && entry.banks.length) {
        throw new BadRequestException(
          `Method ${entry.method} is priced by amount and takes no bank rates`,
        );
      }

      if (method.rateKind === RateKind.ByBank && entry.bands.length) {
        throw new BadRequestException(
          `Method ${entry.method} is priced by bank and takes no amount bands`,
        );
      }

      if (!bandsAreValid(entry.bands)) {
        throw new BadRequestException('Overlapping or invalid rate bands');
      }

      const methodBankIds = entry.banks.map((bank) => bank.bankId);

      if (new Set(methodBankIds).size !== methodBankIds.length) {
        throw new BadRequestException(
          `Method ${entry.method} has more than one rate for the same bank`,
        );
      }

      bankIds.push(...methodBankIds);
    }

    const wanted = [...new Set(bankIds)];
    const found = new Set(
      (await this.banks.findByIds(wanted)).map((bank) => bank.id),
    );
    const missing = wanted.filter((id) => !found.has(id));

    if (missing.length) {
      throw new BadRequestException(
        `Bank ${missing.join(', ')} does not exist`,
      );
    }
  }
}
