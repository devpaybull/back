import { ApiProperty } from '@nestjs/swagger';
import { formatCrypto } from '../../common/utils/format-crypto';
import { Wallet } from '../../transactions/entities/wallet.entity';

export class BalancesDto {
  @ApiProperty({ type: String, example: '100.000000' })
  mainBalance: string;

  @ApiProperty({ type: String, example: '100.000000' })
  mainReserved: string;

  @ApiProperty({ type: String, example: '100.000000' })
  availableMain: string;

  @ApiProperty({ type: String, example: '100.000000' })
  insurancePayInBalance: string;

  @ApiProperty({ type: String, example: '100.000000' })
  insurancePayOutBalance: string;

  @ApiProperty({ type: String, example: '100.000000' })
  insurancePayInReserved: string;

  @ApiProperty({ type: String, example: '100.000000' })
  insurancePayOutReserved: string;

  @ApiProperty({ nullable: true })
  lastAcceptedDealAt: Date;
}

export const toBalancesDto = (wallet: Wallet): BalancesDto => ({
  mainBalance: formatCrypto(wallet.mainBalance),
  mainReserved: formatCrypto(wallet.mainReserved),
  availableMain: formatCrypto(wallet.mainBalance.minus(wallet.mainReserved)),
  insurancePayInBalance: formatCrypto(wallet.insurancePayInBalance),
  insurancePayOutBalance: formatCrypto(wallet.insurancePayOutBalance),
  insurancePayInReserved: formatCrypto(wallet.insurancePayInReserved),
  insurancePayOutReserved: formatCrypto(wallet.insurancePayOutReserved),
  lastAcceptedDealAt: wallet.lastAcceptedDealAt,
});
