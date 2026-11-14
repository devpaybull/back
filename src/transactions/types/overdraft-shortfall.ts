import { Crypto } from '../../common/types/crypto';
import { OverdraftParty } from './overdraft-party.enum';

export interface OverdraftShortfall {
  party: OverdraftParty;
  id: string;
  shortfall: Crypto;
}
