import { NotFoundException } from '@nestjs/common';

export const dealNotFound = (message = 'Deal not found'): NotFoundException =>
  new NotFoundException({ statusCode: 404, code: 'DEAL_NOT_FOUND', message });
