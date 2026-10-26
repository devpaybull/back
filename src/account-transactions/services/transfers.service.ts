import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { formatCrypto } from '../../common/utils/format-crypto';
import { WalletService } from '../../transactions/services/wallet.service';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';
import { TransferInput } from '../types/transfer-input';

@Injectable()
export class TransfersService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly wallets: WalletService,
    private readonly audit: AuditService,
  ) {}

  transfer(
    input: TransferInput,
    before?: (manager: EntityManager) => Promise<void>,
  ): Promise<AccountTransaction> {
    return this.dataSource.transaction(async (manager) => {
      if (before) await before(manager);

      const transfer = await manager.save(
        manager.create(AccountTransaction, {
          type: AccountTransactionType.Transfer,
          status: AccountTransactionStatus.Completed,
          statusReason: null,
          userId: input.fromUserId,
          counterpartyUserId: input.toUserId,
          amount: input.amount,
          comment: input.comment ?? null,
          actorUserId: input.actorUserId,
          completedAt: new Date(),
        }),
      );

      await this.wallets.transferWithin(
        manager,
        input.fromUserId,
        input.toUserId,
        input.amount,
        transfer.id,
      );
      await this.audit.record(
        {
          actorUserId: input.actorUserId,
          targetUserId: input.toUserId,
          action: 'user.transfer',
          metadata: {
            accountTransactionId: transfer.id,
            fromUserId: input.fromUserId,
            toUserId: input.toUserId,
            amount: formatCrypto(input.amount),
          },
        },
        manager,
      );

      return transfer;
    });
  }
}
