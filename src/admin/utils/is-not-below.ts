import {
  ValidateBy,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const isComparable = (value: unknown): boolean =>
  value !== undefined && value !== null && !Number.isNaN(Number(value));

export const IsNotBelow = (
  lowerBoundProperty: string,
  options?: ValidationOptions,
): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isNotBelow',
      constraints: [lowerBoundProperty],
      validator: {
        validate: (value: unknown, args: ValidationArguments): boolean => {
          const lowerBound = (args.object as Record<string, unknown>)[
            lowerBoundProperty
          ];

          if (!isComparable(value) || !isComparable(lowerBound)) return true;

          return Number(value) >= Number(lowerBound);
        },
        defaultMessage: (args: ValidationArguments): string =>
          `${args.property} must not be below ${lowerBoundProperty}`,
      },
    },
    options,
  );
