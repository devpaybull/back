import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TronAddress } from './entities/tron-address.entity';
import { TronOutgoingTransfer } from './entities/tron-outgoing-transfer.entity';
import { TronScanCursor } from './entities/tron-scan-cursor.entity';
import { TronUnavailableFilter } from './filters/tron-unavailable.filter';
import { AppRoleVaultAuth } from './services/approle-vault-auth';
import { EnergyManager } from './services/energy-manager.service';
import { RapiraTrxRateProvider } from './services/rapira-trx-rate.provider';
import { SweepService } from './services/sweep.service';
import { TronConfirmationTracker } from './services/tron-confirmation-tracker.service';
import { TronKeyring } from './services/tron-keyring.service';
import { TronNodeClient } from './services/tron-node.client';
import { TronSender } from './services/tron-sender.service';
import { TronVerifier } from './services/tron-verifier.service';
import { UsdtTransferScanner } from './services/usdt-transfer-scanner.service';
import { VaultTransactionSigner } from './services/vault-transaction.signer';
import { VaultTransitClient } from './services/vault-transit.client';
import { TRANSACTION_SIGNER } from './types/transaction-signer';
import { TRX_RATE_SOURCE } from './types/trx-rate-source';
import { VAULT_AUTH } from './types/vault-auth';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TronAddress,
      TronScanCursor,
      TronOutgoingTransfer,
    ]),
  ],
  providers: [
    { provide: APP_FILTER, useClass: TronUnavailableFilter },
    TronNodeClient,
    VaultTransitClient,
    { provide: VAULT_AUTH, useClass: AppRoleVaultAuth },
    { provide: TRANSACTION_SIGNER, useClass: VaultTransactionSigner },
    { provide: TRX_RATE_SOURCE, useClass: RapiraTrxRateProvider },
    TronKeyring,
    UsdtTransferScanner,
    TronSender,
    TronConfirmationTracker,
    TronVerifier,
    EnergyManager,
    SweepService,
  ],
  exports: [
    TronKeyring,
    UsdtTransferScanner,
    TronSender,
    TronConfirmationTracker,
    TronVerifier,
    EnergyManager,
  ],
})
export class TronModule {}
