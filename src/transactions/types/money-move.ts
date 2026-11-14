import { Crypto } from '../../common/types/crypto';
import { OverdraftParty } from './overdraft-party.enum';

export interface MoneyMove {
  party: OverdraftParty;
  id: string;
  delta: Crypto;
}
