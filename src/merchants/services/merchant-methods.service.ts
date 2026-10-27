import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethodDefinition } from '../../transactions/types/transaction-method-definition';
import { findTransactionMethod } from '../../transactions/utils/find-transaction-method';
import { TRANSACTION_METHODS } from '../../transactions/utils/transaction-methods';
import { MerchantMethod } from '../entities/merchant-method.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantMethodState } from '../types/merchant-method-state';

const REGISTRY: readonly TransactionMethodDefinition[] = TRANSACTION_METHODS;

const statesOf = (rows: MerchantMethod[]): MerchantMethodState[] => {
  const byMethod = new Map(rows.map((row) => [row.method, row]));

  return REGISTRY.map(({ code }) => ({
    method: code,
    payInEnabled: byMethod.get(code)?.payInEnabled ?? false,
    payOutEnabled: byMethod.get(code)?.payOutEnabled ?? false,
  }));
};

@Injectable()
export class MerchantMethodsService {
  constructor(
    @InjectRepository(MerchantMethod)
    private readonly methods: Repository<MerchantMethod>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async statesByMerchant(
    merchantIds: string[],
  ): Promise<Map<string, MerchantMethodState[]>> {
    const rows = merchantIds.length
      ? await this.methods.find({ where: { merchantId: In(merchantIds) } })
      : [];

    return new Map(
      merchantIds.map((merchantId) => [
        merchantId,
        statesOf(rows.filter((row) => row.merchantId === merchantId)),
      ]),
    );
  }

  async replace(
    merchantId: string,
    entries: MerchantMethodState[],
    actorUserId: string,
  ): Promise<MerchantMethodState[]> {
    const seen = new Set<string>();

    for (const entry of entries) {
      const method = findTransactionMethod(entry.method);

      if (!method) {
        throw new BadRequestException(`Unknown method ${entry.method}`);
      }
      if (seen.has(entry.method)) {
        throw new BadRequestException(
          `Method ${entry.method} appears more than once in the set`,
        );
      }
      seen.add(entry.method);

      if (
        entry.payInEnabled &&
        !method.directions.includes(TransactionKind.PayIn)
      ) {
        throw new BadRequestException(`Method ${entry.method} has no pay-in`);
      }
      if (
        entry.payOutEnabled &&
        !method.directions.includes(TransactionKind.PayOut)
      ) {
        throw new BadRequestException(`Method ${entry.method} has no pay-out`);
      }
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const merchant = await manager.findOne(Merchant, {
        where: { id: merchantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!merchant) throw new NotFoundException('Merchant not found');

      await manager.delete(MerchantMethod, { merchantId });

      const rows = entries.map((entry) =>
        manager.create(MerchantMethod, {
          merchantId,
          method: entry.method,
          payInEnabled: entry.payInEnabled,
          payOutEnabled: entry.payOutEnabled,
        }),
      );
      const stored = rows.length ? await manager.save(rows) : [];

      await this.audit.record(
        {
          actorUserId,
          action: 'merchant.methods_replaced',
          metadata: { merchantId, methods: statesOf(stored) },
        },
        manager,
      );

      return stored;
    });

    return statesOf(saved);
  }
}
