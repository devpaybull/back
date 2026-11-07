import { SelectionFilter } from '../types/selection-filter.enum';

export class CandidateRejectedError extends Error {
  constructor(readonly reason: SelectionFilter) {
    super(`The candidate was rejected under lock: ${reason}`);
    this.name = 'CandidateRejectedError';
  }
}
