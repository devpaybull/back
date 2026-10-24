import { registerDecorator, ValidationOptions } from 'class-validator';

export function isIanaTimeZone(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function IsIanaTimeZone(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: target.constructor,
      propertyName,
      options: {
        message: ({ property }) => `${property} must be an IANA time zone`,
        ...options,
      },
      validator: { validate: isIanaTimeZone },
    });
  };
}
