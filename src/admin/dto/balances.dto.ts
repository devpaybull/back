import { ApiProperty } from '@nestjs/swagger';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { roundMoney } from '../../transactions/utils/round-money';

export class BalancesDto {
  @ApiProperty()
  mainBalance: number;

  @ApiProperty()
  mainReserved: number;

  @ApiProperty()
  availableMain: number;

  @ApiProperty()
  insurancePayInBalance: number;

  @ApiProperty()
  insurancePayOutBalance: number;

  @ApiProperty()
  insurancePayInReserved: number;

  @ApiProperty()
  insurancePayOutReserved: number;

  @ApiProperty({ nullable: true })
  lastAcceptedDealAt: Date;
}

export const toBalancesDto = (wallet: Wallet): BalancesDto => ({
  mainBalance: wallet.mainBalance,
  mainReserved: wallet.mainReserved,
  availableMain: roundMoney(wallet.mainBalance - wallet.mainReserved),
  insurancePayInBalance: wallet.insurancePayInBalance,
  insurancePayOutBalance: wallet.insurancePayOutBalance,
  insurancePayInReserved: wallet.insurancePayInReserved,
  insurancePayOutReserved: wallet.insurancePayOutReserved,
  lastAcceptedDealAt: wallet.lastAcceptedDealAt,
});
