import { ConflictException } from '@nestjs/common';

export class FeeChangedException extends ConflictException {
  constructor(fee: string) {
    super({
      statusCode: 409,
      error: 'Conflict',
      message: `The network fee changed to ${fee} USDT; confirm the new quote`,
      fee,
    });
  }
}
