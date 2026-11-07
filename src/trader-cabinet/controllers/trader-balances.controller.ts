import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FinanceOperationDto,
  toFinanceOperationDto,
} from '../../account-transactions/dto/finance-operation.dto';
import { TransfersService } from '../../account-transactions/services/transfers.service';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Rate } from '../../common/types/rate';
import { AuthenticatedUser } from '../../common/types/token';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatRate } from '../../common/utils/format-rate';
import { toCrypto } from '../../common/utils/to-crypto';
import { RateService } from '../../transactions/services/rate.service';
import { WalletService } from '../../transactions/services/wallet.service';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { TraderBalancesDto } from '../dto/trader-balances.dto';
import { TransferBalanceDto } from '../dto/transfer-balance.dto';
import { BalanceTransferDirection } from '../types/balance-transfer-direction.enum';

const NO_MARKUP = 0;

const BALANCES_OF_DIRECTION: Record<
  BalanceTransferDirection,
  { from: BalanceKind; to: BalanceKind }
> = {
  [BalanceTransferDirection.MainToInsurancePayIn]: {
    from: BalanceKind.Main,
    to: BalanceKind.InsurancePayIn,
  },
  [BalanceTransferDirection.InsurancePayInToMain]: {
    from: BalanceKind.InsurancePayIn,
    to: BalanceKind.Main,
  },
  [BalanceTransferDirection.InsurancePayOutToMain]: {
    from: BalanceKind.InsurancePayOut,
    to: BalanceKind.Main,
  },
};

@ApiTags('Trader · Finances')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader/balances')
export class TraderBalancesController {
  private readonly logger = new Logger(TraderBalancesController.name);

  constructor(
    private readonly wallets: WalletService,
    private readonly rates: RateService,
    private readonly transfers: TransfersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The main and insurance balances, and the rate' })
  @ApiEnvelopeResponse(TraderBalancesDto)
  async balances(
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<TraderBalancesDto> {
    const [wallet, rate] = await Promise.all([
      this.wallets.findByUserId(trader.id),
      this.currentRate(),
    ]);
    const zero = toCrypto(0);

    return {
      main: formatCrypto(wallet?.mainBalance ?? zero),
      mainReserved: formatCrypto(wallet?.mainReserved ?? zero),
      available: formatCrypto(
        wallet ? this.wallets.getAvailableMain(wallet) : zero,
      ),
      insurancePayIn: formatCrypto(wallet?.insurancePayInBalance ?? zero),
      insurancePayOut: formatCrypto(wallet?.insurancePayOutBalance ?? zero),
      rate: rate && formatRate(rate),
    };
  }

  @Post('transfer')
  @WriteAccess()
  @ApiOperation({
    summary: 'Moves USDT between the trader’s own balances',
    description:
      'Main to insurance pay-in, or either insurance back to main. Back to main before INSURANCE_WITHDRAWAL_DELAY_DAYS have passed since the last accepted deal is a 409 INSURANCE_WITHDRAWAL_DELAYED with `availableAt`; not enough available is a 409 INSUFFICIENT_BALANCE.',
  })
  @ApiEnvelopeResponse(FinanceOperationDto, { status: HttpStatus.CREATED })
  async transfer(
    @CurrentUser() trader: AuthenticatedUser,
    @Body() dto: TransferBalanceDto,
  ): Promise<FinanceOperationDto> {
    const row = await this.transfers.transferOwnBalance({
      userId: trader.id,
      ...BALANCES_OF_DIRECTION[dto.direction],
      amount: toCrypto(dto.amount),
      actorUserId: trader.id,
      impersonatorUserId: trader.impersonatedBy ?? null,
      insuranceDelayCheckedAt: new Date(),
    });

    return toFinanceOperationDto(row, trader.id);
  }

  private async currentRate(): Promise<Rate | null> {
    try {
      return await this.rates.merchantSourceRate(NO_MARKUP);
    } catch (error) {
      this.logger.warn(
        `No rate for the balances: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    }
  }
}
