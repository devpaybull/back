import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TronAddress } from './entities/tron-address.entity';
import { TronOutgoingTransfer } from './entities/tron-outgoing-transfer.entity';
import { TronScanCursor } from './entities/tron-scan-cursor.entity';
import { TronUnavailableFilter } from './filters/tron-unavailable.filter';
import { AppRoleVaultAuth } from './services/approle-vault-auth';
import { EnergyManager } from './services/energy-manager.service';
import { EnvKeyMaterialSource } from './services/env-key-material.source';
import { LocalTransactionSigner } from './services/local-transaction.signer';
import { RapiraTrxRateProvider } from './services/rapira-trx-rate.provider';
import { SweepService } from './services/sweep.service';
import { TronConfirmationTracker } from './services/tron-confirmation-tracker.service';
import { TronKeyring } from './services/tron-keyring.service';
import { TronNodeClient } from './services/tron-node.client';
import { TronSender } from './services/tron-sender.service';
import { TronVerifier } from './services/tron-verifier.service';
import { UsdtTransferScanner } from './services/usdt-transfer-scanner.service';
import { VaultKeyMaterialSource } from './services/vault-key-material.source';
import { VaultTransitClient } from './services/vault-transit.client';
import { KEY_MATERIAL_SOURCE } from './types/key-material-source';
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
    {
      provide: KEY_MATERIAL_SOURCE,
      inject: [ConfigService, VaultTransitClient],
      useFactory: (config: ConfigService, vault: VaultTransitClient) =>
        config.get<string>('KEY_SOURCE') === 'env'
          ? new EnvKeyMaterialSource(config)
          : new VaultKeyMaterialSource(config, vault),
    },
    { provide: TRANSACTION_SIGNER, useClass: LocalTransactionSigner },
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
