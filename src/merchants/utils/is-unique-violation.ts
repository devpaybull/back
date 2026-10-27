import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';

export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string }).code === UNIQUE_VIOLATION;
