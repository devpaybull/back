import { SelectionSummary } from '../types/selection-summary';

export class NoRequisiteFoundError extends Error {
  constructor(readonly summary: SelectionSummary) {
    super('No requisite was found for this amount');
    this.name = 'NoRequisiteFoundError';
  }
}
