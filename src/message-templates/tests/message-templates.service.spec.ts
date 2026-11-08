import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ILike } from 'typeorm';
import { MESSAGE_TEXT_MAX_LENGTH } from '../../common/utils/message-text-max-length';
import { BankMessageTemplate } from '../entities/bank-message-template.entity';
import { MessageTemplatesService } from '../message-templates.service';
import { BankMessageType } from '../types/bank-message-type.enum';

const CREDIT = 'Зачисление (?<amount>[\\d\\s]+(?:[.,]\\d{1,2})?) ?р';
const CATASTROPHIC = '^(?<amount>a+)+$';

const templateOf = (
  overrides: Partial<BankMessageTemplate> = {},
): BankMessageTemplate =>
  ({
    id: 1,
    bankId: 5,
    sender: '900',
    messageType: BankMessageType.Credit,
    pattern: CREDIT,
    active: true,
    ...overrides,
  }) as BankMessageTemplate;

const build = (templates: BankMessageTemplate[] = [], bankExists = true) => {
  const repository = {
    find: jest.fn(async () => templates),
    findOne: jest.fn(async () => templates[0] ?? null),
    findAndCount: jest.fn(async () => [templates, templates.length]),
    create: jest.fn((value: object) => value),
    merge: jest.fn((row: object, changes: object) =>
      Object.assign(row, changes),
    ),
    save: jest.fn(async (value: object) => ({ id: 1, ...value })),
    delete: jest.fn(async () => ({ affected: templates.length })),
  };
  const banks = {
    findById: jest.fn(async () => (bankExists ? { id: 5 } : null)),
  };
  const service = new MessageTemplatesService(
    repository as never,
    banks as never,
  );

  return { service, repository, banks };
};

const input = {
  bankId: 5,
  sender: '900',
  messageType: BankMessageType.Credit,
  pattern: CREDIT,
};

describe('MessageTemplatesService', () => {
  describe('the pattern an admin saves', () => {
    it('stores a pattern that compiles and has the amount group', async () => {
      const { service, repository } = build();

      await service.create(input);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: CREDIT, bankId: 5 }),
      );
    });

    it.each([
      ['does not compile', 'Зачисление (?<amount>\\d+'],
      ['has no amount group', 'Зачисление (\\d+)'],
      ['names the group otherwise', 'Зачисление (?<sum>\\d+)'],
      ['only escapes the group', 'Зачисление \\(?<amount>\\d+'],
      ['hides the group in a class', 'Зачисление [(?<amount>]\\d+'],
    ])('refuses a pattern that %s with a 400', async (_case, pattern) => {
      const { service, repository } = build();

      await expect(
        service.create({ ...input, pattern }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('refuses an unknown bank with a 400', async () => {
      const { service, repository } = build([], false);

      await expect(service.create(input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('checks a new pattern on update and answers 404 for an unknown template', async () => {
      await expect(
        build([templateOf()]).service.update(1, { pattern: '(\\d+)' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        build([]).service.update(1, { active: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(build([]).service.delete(1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('test', () => {
    it.each([
      ['Зачисление 1500р', '1500.00'],
      ['Зачисление 1 500,50 р', '1500.50'],
      ['Зачисление 1 500.5 р', '1500.50'],
      ['ЗАЧИСЛЕНИЕ 12 р', '12.00'],
    ])('reads «%s» as %s', (text, amount) => {
      const result = build().service.test(CREDIT, text);

      expect(result.matched).toBe(true);
      expect(result.amount?.toFixed(2)).toBe(amount);
    });

    it('answers no amount when the group holds something that is not one amount', () => {
      const result = build().service.test(
        '(?<amount>[\\d.,]+)',
        'Зачисление 1,000.50',
      );

      expect(result).toEqual({ matched: true, amount: null });
    });

    it('answers no match on a text the pattern does not fit', () => {
      expect(build().service.test(CREDIT, 'Списание 100р')).toEqual({
        matched: false,
        amount: null,
      });
    });

    it('cuts off a catastrophic pattern with a 400 instead of hanging', () => {
      const started = Date.now();

      expect(() =>
        build().service.test(CATASTROPHIC, `${'a'.repeat(40)}!`),
      ).toThrow(BadRequestException);
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  describe('recognise', () => {
    it('asks only the active templates of the sender, without case, in id order', async () => {
      const { service, repository } = build();

      await service.recognise(' Sber_% ', 'text');

      expect(repository.find).toHaveBeenCalledWith({
        where: { sender: ILike('Sber\\_\\%'), active: true },
        order: { id: 'ASC' },
      });
    });

    it('takes the first template that reads an amount', async () => {
      const statement = templateOf({
        id: 1,
        messageType: BankMessageType.Statement,
        pattern: 'Выписка (?<amount>\\d+)',
      });
      const credit = templateOf({ id: 2 });
      const { service } = build([statement, credit]);

      const recognised = await service.recognise('900', 'Зачисление 700 р');

      expect(recognised.senderKnown).toBe(true);
      expect(recognised.template).toBe(credit);
      expect(recognised.amount?.toFixed(2)).toBe('700.00');
    });

    it('knows the sender but reads nothing when no template fits', async () => {
      const { service } = build([templateOf()]);

      await expect(service.recognise('900', 'Код 1234')).resolves.toEqual({
        senderKnown: true,
        template: null,
        amount: null,
      });
    });

    it('does not know a sender without templates', async () => {
      await expect(
        build([]).service.recognise('X', 'Зачисление 5 р'),
      ).resolves.toEqual({
        senderKnown: false,
        template: null,
        amount: null,
      });
    });

    it('skips a template that runs too long and goes on to the next', async () => {
      const slow = templateOf({ id: 1, pattern: CATASTROPHIC });
      const digits = templateOf({ id: 3, pattern: '(?<amount>\\d+)' });

      const second = await build([slow, digits]).service.recognise(
        '900',
        `${'a'.repeat(40)}! 25`,
      );

      expect(second.template?.id).toBe(3);
      expect(second.amount?.toFixed(2)).toBe('25.00');
    });

    it('spends at most 100 ms on one message across the sender’s templates', async () => {
      const slow = [1, 2, 3].map((id) =>
        templateOf({ id, pattern: CATASTROPHIC }),
      );
      const fine = templateOf({ id: 4, pattern: '(?<amount>\\d+)' });
      const { service } = build([...slow, fine]);
      const warned = jest
        .spyOn(
          (service as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation();
      const started = Date.now();

      const recognised = await service.recognise(
        '900',
        `${'a'.repeat(40)}! 25`,
      );

      expect(Date.now() - started).toBeLessThan(400);
      expect(recognised.template).toBeNull();
      expect(warned).toHaveBeenLastCalledWith(
        expect.stringContaining('budget is spent'),
      );
    });

    it('compiles a template once and again only when its pattern changes', async () => {
      const template = templateOf({ pattern: '(?<amount>\\d+)' });
      const { service } = build([template]);
      const compiled = (
        service as unknown as {
          compiled: Map<number, { pattern: RegExp }>;
        }
      ).compiled;

      await service.recognise('900', '10');
      const first = compiled.get(1)?.pattern;
      await service.recognise('900', '20');

      expect(compiled.get(1)?.pattern).toBe(first);

      template.pattern = 'Сумма (?<amount>\\d+)';
      const recognised = await service.recognise('900', 'Сумма 30');

      expect(compiled.get(1)?.pattern).not.toBe(first);
      expect(recognised.amount?.toFixed(2)).toBe('30.00');
    });

    it('forgets the compiled pattern of a deleted template', async () => {
      const { service } = build([templateOf({ pattern: '(?<amount>\\d+)' })]);
      const compiled = (
        service as unknown as { compiled: Map<number, unknown> }
      ).compiled;

      await service.recognise('900', '10');
      await service.delete(1);

      expect(compiled.has(1)).toBe(false);
    });

    it('does not run a pattern on a text above the cap', async () => {
      const { service } = build([templateOf({ pattern: '(?<amount>\\d+)' })]);

      const recognised = await service.recognise(
        '900',
        `1${' '.repeat(MESSAGE_TEXT_MAX_LENGTH)}`,
      );

      expect(recognised.template).toBeNull();
    });
  });
});
