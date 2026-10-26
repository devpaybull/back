export class TronUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TronUnavailableError';
  }
}
