import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';
import { ValidationFailedException } from '../exceptions/validation-failed.exception';
import { FieldErrorsValidationPipe } from '../pipes/field-errors-validation.pipe';

class InnerDto {
  @IsString()
  userId: string;
}

class OuterDto {
  @IsString()
  name: string;

  @ValidateNested()
  @Type(() => InnerDto)
  inner: InnerDto;
}

const OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};

const refusal = async (pipe: ValidationPipe): Promise<BadRequestException> =>
  pipe
    .transform(
      { name: 1, inner: { userId: 2 }, extra: true },
      { type: 'body', metatype: OuterDto },
    )
    .then(
      () => {
        throw new Error('expected a refusal');
      },
      (error: BadRequestException) => error,
    );

describe('FieldErrorsValidationPipe', () => {
  it('answers exactly the body the stock ValidationPipe answers', async () => {
    const ours = await refusal(new FieldErrorsValidationPipe(OPTIONS));
    const stock = await refusal(new ValidationPipe(OPTIONS));

    expect(ours).toBeInstanceOf(BadRequestException);
    expect(ours.getStatus()).toBe(400);
    expect(ours.getResponse()).toEqual(stock.getResponse());
  });

  it('keeps the class-validator errors on the exception', async () => {
    const ours = await refusal(new FieldErrorsValidationPipe(OPTIONS));

    expect(ours).toBeInstanceOf(ValidationFailedException);
    expect(
      (ours as ValidationFailedException).validationErrors
        .map((error) => error.property)
        .sort(),
    ).toEqual(['extra', 'inner', 'name']);
  });
});
