import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BankDetailsService } from '../bank-details/bank-details.service';
import { Bank } from '../banks/entities/bank.entity';
import { BanksService } from '../banks/banks.service';
import { Fiat } from '../common/types/fiat';
import { Page } from '../common/types/page';
import { Rate } from '../common/types/rate';
import { roundFiat } from '../common/utils/round-fiat';
import { CounterpartiesService } from '../counterparties/services/counterparties.service';
import { MerchantRequestDetails } from '../merchant-requests/types/merchant-request-details';
import { MerchantRequestOperation } from '../merchant-requests/types/merchant-request-operation.enum';
import { MerchantCurrenciesService } from '../merchants/services/merchant-currencies.service';
import { MerchantMethodsService } from '../merchants/services/merchant-methods.service';
import { MerchantSettingsService } from '../merchants/services/merchant-settings.service';
import { MobileOperatorsService } from '../mobile-operators/mobile-operators.service';
import { PaymentDto } from '../transactions/dto/payment.dto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DisputesService } from '../transactions/services/disputes.service';
import { PaymentViewService } from '../transactions/services/payment-view.service';
import { Transaction } from '../transactions/entities/transaction.entity';
import { NoRequisiteFoundError } from '../transactions/exceptions/no-requisite-found.exception';
import { MerchantDealsService } from '../transactions/services/merchant-deals.service';
import { RateService } from '../transactions/services/rate.service';
import { RequisiteSelectionService } from '../transactions/services/requisite-selection.service';
import { TransactionService } from '../transactions/services/transaction.service';
import { MerchantDealListQuery } from '../transactions/types/merchant-deal-list-query';
import { RateDirection } from '../transactions/types/rate-candidate';
import { RateScope } from '../transactions/types/rate-scope.enum';
import { TransactionKind } from '../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../transactions/types/transaction-method';
import { findTransactionMethod } from '../transactions/utils/find-transaction-method';
import { NoBaseRateError } from '../transactions/utils/resolve-rate';
import { MerchantApiErrorCode } from './types/merchant-api-error-code.enum';
import { ApiPaymentMethod } from './types/api-payment-method';
import { PayInOutcome } from './types/pay-in-outcome';
import { PayInRequest } from './types/pay-in-request';
import { PayOutOutcome } from './types/pay-out-outcome';
import { PayOutRequest } from './types/pay-out-request';

const FAILED_DEALS_WINDOW_MS = 60 * 60_000;

const dealNotFound = (): NotFoundException =>
  new NotFoundException({
    code: MerchantApiErrorCode.DealNotFound,
    message: 'Deal not found',
  });

@Injectable()
export class MerchantApiService {
  constructor(
    private readonly methods: MerchantMethodsService,
    private readonly settings: MerchantSettingsService,
    private readonly currencies: MerchantCurrenciesService,
    private readonly banks: BanksService,
    private readonly operators: MobileOperatorsService,
    private readonly bankDetails: BankDetailsService,
    private readonly counterparties: CounterpartiesService,
    private readonly transactions: TransactionService,
    private readonly deals: MerchantDealsService,
    private readonly rates: RateService,
    private readonly selection: RequisiteSelectionService,
    private readonly disputes: DisputesService,
    private readonly paymentView: PaymentViewService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findPayment(merchantId: string, id: string): Promise<PaymentDto> {
    const deal = await this.ownDeal(() => this.deals.findOwn(merchantId, id));

    return this.paymentOf(deal);
  }

  async findPaymentByMerchantTransactionId(
    merchantId: string,
    merchantTransactionId: string,
  ): Promise<PaymentDto> {
    const deal = await this.transactions.findByMerchantTransactionId(
      merchantId,
      merchantTransactionId,
    );

    if (!deal) throw dealNotFound();

    return this.paymentOf(deal);
  }

  async listPayments(
    merchantId: string,
    query: MerchantDealListQuery,
  ): Promise<Page<PaymentDto>> {
    const page = await this.deals.list(merchantId, query);

    return new Page(await this.paymentsOf(page.items), page.meta);
  }

  async cancelPayment(merchantId: string, id: string): Promise<PaymentDto> {
    const deal = await this.ownDeal(
      () => this.transactions.cancelByMerchant(merchantId, id),
      {
        code: MerchantApiErrorCode.DealNotCancelable,
        message: 'Only an active pay-in or a pending pay-out can be canceled',
      },
    );

    return this.paymentOf(deal);
  }

  async openDispute(
    merchantId: string,
    id: string,
    fileKeys: readonly string[],
    amountFiat: Fiat | null,
  ): Promise<PaymentDto> {
    return this.paymentOf(
      await this.disputes.openByMerchant(merchantId, id, fileKeys, amountFiat),
    );
  }

  async cancelDispute(merchantId: string, id: string): Promise<PaymentDto> {
    return this.paymentOf(await this.disputes.cancelByMerchant(merchantId, id));
  }

  async extendPaymentTimer(
    merchantId: string,
    id: string,
  ): Promise<PaymentDto> {
    const deal = await this.ownDeal(
      () => this.transactions.extendTimerByMerchant(merchantId, id),
      {
        code: MerchantApiErrorCode.TimerNotExtendable,
        message:
          'The timer of a pay-in can be extended once, while it is still running',
      },
    );

    return this.paymentOf(deal);
  }

  private async ownDeal(
    work: () => Promise<Transaction>,
    conflict?: { code: MerchantApiErrorCode; message: string },
  ): Promise<Transaction> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof NotFoundException) throw dealNotFound();
      if (conflict && error instanceof ConflictException) {
        throw new ConflictException(conflict);
      }
      throw error;
    }
  }

  async createPayIn(
    merchantId: string,
    requestId: string | null,
    request: PayInRequest,
    log: MerchantRequestDetails,
  ): Promise<PayInOutcome> {
    Object.assign(log, {
      operation: MerchantRequestOperation.PayInCreate,
      direction: TransactionKind.PayIn,
      paymentMethod: request.method,
      amountFiat: request.amount,
      currency: request.currency ?? null,
      payerUserId: request.payerInfo.userId,
      merchantTransactionId: request.merchantTransactionId,
    });

    const method = this.methodOf(request, TransactionKind.PayIn);

    log.currency = method.currency;
    await this.assertMethodEnabled(merchantId, method.code, 'payInEnabled');

    const requestedBank = await this.bankOf(request.bank, 'bank');
    const payerBank = await this.bankOf(request.payerBank, 'payerBank');
    const operatorId = await this.operatorIdOf(request.operator);

    log.requestedBankId = requestedBank?.id ?? null;

    const existing = await this.transactions.findByMerchantTransactionId(
      merchantId,
      request.merchantTransactionId,
    );

    if (existing) {
      return this.replayPayIn(existing, request, requestedBank, log);
    }

    const settings = await this.settings.settingsOf(merchantId);

    this.assertAboveMinimum(
      request.amount,
      method.code,
      settings.minPayInAmount,
    );

    const counterparty = await this.counterparties.findOrCreate(
      merchantId,
      request.payerInfo.userId,
    );

    log.counterpartyId = counterparty.id;

    if (!counterparty.enabled || counterparty.blacklistedAt) {
      throw new ForbiddenException({
        code: MerchantApiErrorCode.PayerBlocked,
        message: 'The payer is blocked',
      });
    }

    if (settings.failedDealsLimitEnabled) {
      const failed = await this.transactions.countFailedPayInsSince(
        merchantId,
        counterparty.id,
        new Date(Date.now() - FAILED_DEALS_WINDOW_MS),
      );

      if (failed >= settings.failedDealsPerHour) {
        throw new ForbiddenException({
          code: MerchantApiErrorCode.FailedDealsLimit,
          message: 'The payer has reached the limit of failed deals per hour',
        });
      }
    }

    if (settings.sameRequestsEnabled) {
      const same = await this.transactions.findActiveSameRequest({
        merchantId,
        counterpartyId: counterparty.id,
        method: method.code,
        requestedAmountFiat: request.amount,
      });

      if (same) {
        this.logDeal(log, same);

        return {
          payment: await this.paymentOf(same),
          created: false,
          sameRequest: true,
        };
      }
    }

    const amountFiat = roundFiat(
      request.amount.plus(
        Math.floor(Math.random() * (settings.randomizationWindow + 1)),
      ),
    );
    const rate = await this.merchantRate(
      merchantId,
      method.currency,
      'payInMarkupPercent',
    );
    const merchantPercent = await this.merchantPercent(
      merchantId,
      method.code,
      amountFiat,
      requestedBank?.id ?? null,
      'payIn',
    );

    try {
      const issued = await this.selection.issue({
        requestId,
        merchantId,
        method: method.code,
        amountFiat,
        rate,
        merchantPercent,
        counterpartyId: counterparty.id,
        merchantTransactionId: request.merchantTransactionId,
        payerInfo: request.payerInfo,
        requestedBankId: requestedBank?.id ?? null,
        requestedOperatorId: operatorId,
        payerBankId: payerBank?.id ?? null,
        callbackUrl: request.callbackUrl ?? null,
        successUrl: request.successUrl ?? null,
        errorUrl: request.errorUrl ?? null,
        requestedAmountFiat: request.amount,
      });

      this.logDeal(log, issued.transaction);
      log.selectionSummary = issued.summary;

      return {
        payment: await this.paymentOf(issued.transaction, requestedBank),
        created: true,
        sameRequest: false,
      };
    } catch (error) {
      const raced = await this.transactions.findByMerchantTransactionId(
        merchantId,
        request.merchantTransactionId,
      );

      if (raced) return this.replayPayIn(raced, request, requestedBank, log);
      if (error instanceof NoRequisiteFoundError) {
        log.selectionSummary = error.summary;
      }
      throw error;
    }
  }

  async createPayOut(
    merchantId: string,
    request: PayOutRequest,
    log: MerchantRequestDetails,
  ): Promise<PayOutOutcome> {
    Object.assign(log, {
      operation: MerchantRequestOperation.PayOutCreate,
      direction: TransactionKind.PayOut,
      paymentMethod: request.method,
      amountFiat: request.amount,
      currency: request.currency ?? null,
      payerUserId: request.payerInfo?.userId,
      merchantTransactionId: request.merchantTransactionId,
    });

    const method = this.methodOf(request, TransactionKind.PayOut);

    log.currency = method.currency;
    await this.assertMethodEnabled(merchantId, method.code, 'payOutEnabled');

    const bank = await this.activeBankOf(
      request.requisite.bank,
      'requisite.bank',
    );

    log.requestedBankId = bank.id;

    const existing = await this.transactions.findByMerchantTransactionId(
      merchantId,
      request.merchantTransactionId,
    );

    if (existing) return this.replayPayOut(existing, request, bank, log);

    const rate = await this.merchantRate(
      merchantId,
      method.currency,
      'payOutMarkupPercent',
    );
    const merchantPercent = await this.merchantPercent(
      merchantId,
      method.code,
      request.amount,
      bank.id,
      'payOut',
    );

    try {
      const created = await this.transactions.createPayOutRequest({
        method: method.code,
        merchantId,
        merchantTransactionId: request.merchantTransactionId,
        amountFiat: request.amount,
        rate,
        merchantPercent,
        windowMinutes: request.timeoutInMin ?? null,
        payoutOwnerName: request.requisite.ownerName,
        payoutBankId: bank.id,
        payoutCardNumber: request.requisite.cardNumber ?? null,
        payoutPhone: request.requisite.sbpNumber ?? null,
        payerInfo: request.payerInfo ?? null,
        callbackUrl: request.callbackUrl ?? null,
      });

      this.logDeal(log, created);

      return { payment: await this.paymentOf(created), created: true };
    } catch (error) {
      const raced = await this.transactions.findByMerchantTransactionId(
        merchantId,
        request.merchantTransactionId,
      );

      if (raced) return this.replayPayOut(raced, request, bank, log);
      if (error instanceof ConflictException) {
        throw new ConflictException({
          code: MerchantApiErrorCode.InsufficientBalance,
          message: 'The merchant balance does not cover the pay-out',
        });
      }
      throw error;
    }
  }

  private methodOf(
    request: { method: string; currency?: string },
    kind: TransactionKind,
  ): ApiPaymentMethod {
    const method = findTransactionMethod(request.method);

    if (!method?.directions.includes(kind)) {
      throw new BadRequestException({
        code: MerchantApiErrorCode.MethodNotSupported,
        message: `Method ${request.method} does not work for ${kind}`,
      });
    }

    if (
      request.currency !== undefined &&
      request.currency !== method.currency
    ) {
      throw new BadRequestException({
        code: MerchantApiErrorCode.CurrencyMismatch,
        message: `Method ${method.code} works in ${method.currency}`,
      });
    }

    return {
      code: method.code as TransactionMethod,
      currency: method.currency,
    };
  }

  private async assertMethodEnabled(
    merchantId: string,
    method: TransactionMethod,
    direction: 'payInEnabled' | 'payOutEnabled',
  ): Promise<void> {
    const states =
      (await this.methods.statesByMerchant([merchantId])).get(merchantId) ?? [];

    if (!states.find((state) => state.method === method)?.[direction]) {
      throw new ForbiddenException({
        code: MerchantApiErrorCode.MethodDisabled,
        message: `Method ${method} is switched off for this merchant`,
      });
    }
  }

  private async bankOf(
    code: string | undefined,
    field: string,
  ): Promise<Bank | null> {
    return code === undefined ? null : this.activeBankOf(code, field);
  }

  private async activeBankOf(code: string, field: string): Promise<Bank> {
    const bank = await this.banks.findActiveByCode(code);

    if (!bank) {
      throw new BadRequestException({
        code: MerchantApiErrorCode.BankNotFound,
        message: `${field}: no active bank has the code ${code}`,
      });
    }

    return bank;
  }

  private async operatorIdOf(code: string | undefined): Promise<number | null> {
    if (code === undefined) return null;

    const operator = await this.operators.findActiveByCode(code);

    if (!operator) {
      throw new BadRequestException({
        code: MerchantApiErrorCode.ValidationFailed,
        message: `No active mobile operator has the code ${code}`,
        details: [{ field: 'operator', code: 'notFound' }],
      });
    }

    return operator.id;
  }

  private assertAboveMinimum(
    amount: Fiat,
    method: TransactionMethod,
    merchantMinimum: Fiat | null,
  ): void {
    const counterpartyFloor =
      method === 'counterparty' ? this.bankDetails.counterpartyMinAmount : null;

    for (const floor of [merchantMinimum, counterpartyFloor]) {
      if (floor && amount.lt(floor)) {
        throw new ForbiddenException({
          code: MerchantApiErrorCode.AmountBelowMinimum,
          message: 'The amount is below the minimum',
        });
      }
    }
  }

  private async merchantRate(
    merchantId: string,
    currency: string,
    markupField: 'payInMarkupPercent' | 'payOutMarkupPercent',
  ): Promise<Rate> {
    const rows =
      (await this.currencies.currenciesByMerchant([merchantId])).get(
        merchantId,
      ) ?? [];
    const markup =
      rows.find((row) => row.currency?.isocode === currency)?.[markupField] ??
      0;

    try {
      return await this.rates.merchantSourceRate(markup);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new ServiceUnavailableException({
          code: MerchantApiErrorCode.RateUnavailable,
          message: 'The exchange rate is unavailable',
        });
      }
      throw error;
    }
  }

  private async merchantPercent(
    merchantId: string,
    method: TransactionMethod,
    amount: Fiat,
    bankId: number | null,
    direction: RateDirection,
  ): Promise<number> {
    try {
      return await this.rates.resolveMethodPercent({
        scope: RateScope.Merchant,
        method,
        amount,
        bankId,
        direction,
        individualEnabled: true,
        subjectMerchantId: merchantId,
      });
    } catch (error) {
      if (error instanceof NoBaseRateError) {
        throw new ForbiddenException({
          code: MerchantApiErrorCode.RateNotFound,
          message: `No merchant rate is set for ${method}`,
        });
      }
      throw error;
    }
  }

  private async replayPayIn(
    deal: Transaction,
    request: PayInRequest,
    requestedBank: Bank | null,
    log: MerchantRequestDetails,
  ): Promise<PayInOutcome> {
    const requestedAmount = deal.requestedAmountFiat ?? deal.amountFiat;
    const sameBody =
      deal.kind === TransactionKind.PayIn &&
      deal.method === request.method &&
      requestedAmount?.eq(request.amount) === true &&
      (deal.requestedBankId ?? null) === (requestedBank?.id ?? null);

    return {
      payment: await this.replay(deal, sameBody, log),
      created: false,
      sameRequest: false,
    };
  }

  private async replayPayOut(
    deal: Transaction,
    request: PayOutRequest,
    bank: Bank,
    log: MerchantRequestDetails,
  ): Promise<PayOutOutcome> {
    const sameBody =
      deal.kind === TransactionKind.PayOut &&
      deal.method === request.method &&
      deal.amountFiat?.eq(request.amount) === true &&
      deal.payoutBankId === bank.id &&
      deal.payoutOwnerName === request.requisite.ownerName &&
      (deal.payoutCardNumber ?? null) ===
        (request.requisite.cardNumber ?? null) &&
      (deal.payoutPhone ?? null) === (request.requisite.sbpNumber ?? null);

    return {
      payment: await this.replay(deal, sameBody, log),
      created: false,
    };
  }

  private async replay(
    deal: Transaction,
    sameBody: boolean,
    log: MerchantRequestDetails,
  ): Promise<PaymentDto> {
    const payment = await this.paymentOf(deal);

    this.logDeal(log, deal);

    if (!sameBody) {
      throw new ConflictException({
        code: MerchantApiErrorCode.DuplicateMerchantTransactionId,
        message:
          'merchantTransactionId is already taken by a deal with another body',
        details: { deal: payment },
      });
    }

    return payment;
  }

  private logDeal(log: MerchantRequestDetails, deal: Transaction): void {
    log.transactionId = deal.id;
    log.processedByUserId = deal.traderUserId ?? null;
  }

  private async paymentOf(
    deal: Transaction,
    requestedBank?: Bank | null,
  ): Promise<PaymentDto> {
    const [payment] = await this.paymentsOf([deal], requestedBank);

    return payment;
  }

  private paymentsOf(
    deals: Transaction[],
    requestedBank?: Bank | null,
  ): Promise<PaymentDto[]> {
    return this.paymentView.paymentsOf(
      this.dataSource.manager,
      deals,
      requestedBank,
    );
  }
}
