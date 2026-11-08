import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { BanksModule } from '../banks/banks.module';
import { MerchantRequestsModule } from '../merchant-requests/merchant-requests.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { TraderSettingsModule } from '../trader-settings/trader-settings.module';
import { UsersModule } from '../users/users.module';
import { BalanceOperation } from './entities/balance-operation.entity';
import { LeadRate } from './entities/lead-rate.entity';
import { MerchantBalanceOperation } from './entities/merchant-balance-operation.entity';
import { MerchantBalance } from './entities/merchant-balance.entity';
import { MethodRate } from './entities/method-rate.entity';
import { SelectionAttempt } from './entities/selection-attempt.entity';
import { Transaction } from './entities/transaction.entity';
import { TransactionLeadShare } from './entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from './entities/transaction-status-event.entity';
import { Wallet } from './entities/wallet.entity';
import { AttachedFirstRanking } from './services/attached-first-ranking.service';
import { BankDetailsTurnoverService } from './services/bank-details-turnover.service';
import { CounterpartyDealStatsService } from './services/counterparty-deal-stats.service';
import { DealExpiryService } from './services/deal-expiry.service';
import { MerchantBalanceService } from './services/merchant-balance.service';
import { MerchantDealsService } from './services/merchant-deals.service';
import { MerchantRatesService } from './services/merchant-rates.service';
import { PaymentPageService } from './services/payment-page.service';
import { MerchantStatsService } from './services/merchant-stats.service';
import { MerchantVolumeService } from './services/merchant-volume.service';
import { NightStopService } from './services/night-stop.service';
import { TransactionFile } from './entities/transaction-file.entity';
import { PayoutDecline } from './entities/payout-decline.entity';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { RapiraRateProvider } from './services/rapira-rate.provider';
import { RateService } from './services/rate.service';
import { RequisiteSelectionService } from './services/requisite-selection.service';
import { SelectionAttemptRetentionService } from './services/selection-attempt-retention.service';
import { TransactionDispute } from './entities/transaction-dispute.entity';
import { MerchantCallbacksModule } from '../merchant-callbacks/merchant-callbacks.module';
import { DealCallbacksService } from './services/deal-callbacks.service';
import { PaymentViewService } from './services/payment-view.service';
import { DisputeDeadlineService } from './services/dispute-deadline.service';
import { DisputeMoneyService } from './services/dispute-money.service';
import { DisputesService } from './services/disputes.service';
import { PayoutPricingService } from './services/payout-pricing.service';
import { PayoutTimersService } from './services/payout-timers.service';
import { TraderDealActionsService } from './services/trader-deal-actions.service';
import { TraderPayoutActionsService } from './services/trader-payout-actions.service';
import { TraderPayoutsService } from './services/trader-payouts.service';
import { TradingSwitchService } from './services/trading-switch.service';
import { TransactionFilesService } from './services/transaction-files.service';
import { TraderDealsService } from './services/trader-deals.service';
import { TransactionService } from './services/transaction.service';
import { WalletService } from './services/wallet.service';
import { RequisiteRanking } from './types/requisite-ranking';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transaction,
      TransactionStatusEvent,
      Wallet,
      BalanceOperation,
      MethodRate,
      LeadRate,
      TransactionLeadShare,
      MerchantBalance,
      MerchantBalanceOperation,
      SelectionAttempt,
      TransactionFile,
      TransactionDispute,
      PayoutDecline,
    ]),
    AuditModule,
    FileStorageModule,
    MerchantCallbacksModule,
    BanksModule,
    forwardRef(() => BankDetailsModule),
    CounterpartiesModule,
    MerchantRequestsModule,
    MerchantsModule,
    TraderSettingsModule,
    UsersModule,
  ],
  providers: [
    RapiraRateProvider,
    RateService,
    WalletService,
    MerchantBalanceService,
    MerchantVolumeService,
    MerchantStatsService,
    MerchantDealsService,
    MerchantRatesService,
    PaymentPageService,
    PaymentViewService,
    DealCallbacksService,
    DisputeMoneyService,
    DisputesService,
    DisputeDeadlineService,
    TraderDealsService,
    TraderDealActionsService,
    TraderPayoutsService,
    TradingSwitchService,
    TraderPayoutActionsService,
    PayoutPricingService,
    PayoutTimersService,
    TransactionFilesService,
    TransactionService,
    NightStopService,
    BankDetailsTurnoverService,
    CounterpartyDealStatsService,
    DealExpiryService,
    { provide: RequisiteRanking, useClass: AttachedFirstRanking },
    RequisiteSelectionService,
    SelectionAttemptRetentionService,
  ],
  exports: [
    PaymentViewService,
    PaymentPageService,
    MerchantRatesService,
    DisputesService,
    DisputeDeadlineService,
    TraderDealsService,
    TraderDealActionsService,
    TraderPayoutsService,
    TradingSwitchService,
    TraderPayoutActionsService,
    PayoutPricingService,
    PayoutTimersService,
    TransactionFilesService,
    RateService,
    WalletService,
    MerchantBalanceService,
    MerchantVolumeService,
    MerchantStatsService,
    MerchantDealsService,
    TransactionService,
    NightStopService,
    BankDetailsTurnoverService,
    CounterpartyDealStatsService,
    RequisiteSelectionService,
  ],
})
export class TransactionsModule {}
