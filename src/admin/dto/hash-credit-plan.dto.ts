import { ApiProperty } from '@nestjs/swagger';
import { AccountTransactionPartyDto } from './account-transaction-party.dto';
import { HashVerificationDto } from './usdt-transfer-inspection.dto';

export class HashCreditCandidateDto {
  @ApiProperty({ type: AccountTransactionPartyDto, nullable: true })
  user: AccountTransactionPartyDto | null;

  @ApiProperty()
  address: string;

  @ApiProperty({ type: String, example: '100.000000' })
  amount: string;

  @ApiProperty()
  alreadyCredited: boolean;
}

export class HashCreditPlanDto extends HashVerificationDto {
  @ApiProperty({ type: HashCreditCandidateDto, isArray: true })
  candidates: HashCreditCandidateDto[];
}
