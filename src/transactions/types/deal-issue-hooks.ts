import { EntityManager } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { DealCandidate } from './deal-candidate';

export interface DealIssueHooks<C extends DealCandidate = DealCandidate> {
  checkWithin(manager: EntityManager, candidate: C): Promise<void>;
  afterInsertWithin?(
    manager: EntityManager,
    candidate: C,
    transaction: Transaction,
  ): Promise<void>;
}
