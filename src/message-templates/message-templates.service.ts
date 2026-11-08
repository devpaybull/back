import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createContext, Script } from 'node:vm';
import { FindOptionsOrder, FindOptionsWhere, ILike, Repository } from 'typeorm';
import { BanksService } from '../banks/banks.service';
import { Page, toPage } from '../common/types/page';
import { Fiat } from '../common/types/fiat';
import { escapeLikePattern } from '../common/utils/escape-like-pattern';
import { MESSAGE_TEXT_MAX_LENGTH } from '../common/utils/message-text-max-length';
import { sortDirection } from '../common/utils/sort-direction';
import { toFiat } from '../common/utils/to-fiat';
import { BankMessageTemplate } from './entities/bank-message-template.entity';
import { CreateMessageTemplateInput } from './types/create-message-template-input';
import { MessageTemplateChanges } from './types/message-template-changes';
import { MessageTemplateListQuery } from './types/message-template-list-query';
import { MessageTemplateSortField } from './types/message-template-sort-field.enum';
import { PatternTestResult } from './types/pattern-test-result';
import { RecognisedMessage } from './types/recognised-message';

const PATTERN_FLAGS = 'iu';
const PATTERN_TIMEOUT_MS = 50;
const RECOGNITION_BUDGET_MS = 100;
const AMOUNT_GROUP = 'amount';
const AMOUNT_SPACES = /\s/g;
const AMOUNT_SHAPE = /^\d{1,13}(\.\d{1,2})?$/;

const TIMEOUT_CODE = 'ERR_SCRIPT_EXECUTION_TIMEOUT';

@Injectable()
export class MessageTemplatesService {
  private readonly logger = new Logger(MessageTemplatesService.name);
  private readonly sandbox = createContext(Object.create(null));
  private readonly execute = new Script('pattern.exec(text)');
  private readonly compiled = new Map<
    number,
    { source: string; pattern: RegExp }
  >();

  constructor(
    @InjectRepository(BankMessageTemplate)
    private readonly templates: Repository<BankMessageTemplate>,
    private readonly banks: BanksService,
  ) {}

  async create(
    input: CreateMessageTemplateInput,
  ): Promise<BankMessageTemplate> {
    this.assertValidPattern(input.pattern);
    await this.assertBankExists(input.bankId);

    const saved = await this.templates.save(
      this.templates.create({
        bankId: input.bankId,
        sender: input.sender,
        messageType: input.messageType,
        pattern: input.pattern,
        ...(input.active !== undefined ? { active: input.active } : {}),
      }),
    );

    return this.findById(saved.id);
  }

  async list(
    query: MessageTemplateListQuery,
  ): Promise<Page<BankMessageTemplate>> {
    const where: FindOptionsWhere<BankMessageTemplate> = {
      ...(query.bankId !== undefined ? { bankId: query.bankId } : {}),
      ...(query.messageType !== undefined
        ? { messageType: query.messageType }
        : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? { sender: ILike(`%${escapeLikePattern(query.search)}%`) }
        : {}),
    };
    const direction = sortDirection(query.sortOrder);
    const order: FindOptionsOrder<BankMessageTemplate> =
      query.sortBy === MessageTemplateSortField.Id
        ? { id: direction }
        : { [query.sortBy]: direction, id: direction };

    return toPage(
      await this.templates.findAndCount({
        where,
        order,
        relations: { bank: true },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  findById(id: number): Promise<BankMessageTemplate | null> {
    return this.templates.findOne({ where: { id }, relations: { bank: true } });
  }

  async update(
    id: number,
    changes: MessageTemplateChanges,
  ): Promise<BankMessageTemplate> {
    const template = await this.templates.findOne({ where: { id } });

    if (!template) throw new NotFoundException('Message template not found');

    if (changes.pattern !== undefined) this.assertValidPattern(changes.pattern);
    if (changes.bankId !== undefined)
      await this.assertBankExists(changes.bankId);

    await this.templates.save(this.templates.merge(template, changes));

    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const result = await this.templates.delete({ id });

    if (!result.affected) {
      throw new NotFoundException('Message template not found');
    }

    this.compiled.delete(id);
  }

  test(pattern: string, text: string): PatternTestResult {
    this.assertValidPattern(pattern);

    try {
      const match = this.run(
        new RegExp(pattern, PATTERN_FLAGS),
        text,
        PATTERN_TIMEOUT_MS,
      );

      return {
        matched: match !== null,
        amount: this.amountOf(match),
      };
    } catch (error) {
      if ((error as { code?: string }).code === TIMEOUT_CODE) {
        throw new BadRequestException(
          `The pattern ran longer than ${PATTERN_TIMEOUT_MS} ms on this text`,
        );
      }

      throw error;
    }
  }

  async recognise(sender: string, text: string): Promise<RecognisedMessage> {
    const templates = await this.templates.find({
      where: { sender: ILike(escapeLikePattern(sender.trim())), active: true },
      order: { id: 'ASC' },
    });

    const deadline = Date.now() + RECOGNITION_BUDGET_MS;

    for (const template of templates) {
      const remaining = Math.floor(deadline - Date.now());

      if (remaining < 1) {
        this.logger.warn(
          `Reading a message from ${template.sender} stopped at template ${template.id}: the ${RECOGNITION_BUDGET_MS} ms budget is spent`,
        );
        break;
      }

      const amount = this.amountWith(
        template,
        text,
        Math.min(PATTERN_TIMEOUT_MS, remaining),
      );

      if (amount) return { senderKnown: true, template, amount };
    }

    return { senderKnown: templates.length > 0, template: null, amount: null };
  }

  private amountWith(
    template: BankMessageTemplate,
    text: string,
    timeoutMs: number,
  ): Fiat | null {
    try {
      return this.amountOf(this.run(this.patternOf(template), text, timeoutMs));
    } catch (error) {
      this.logger.warn(
        `Message template ${template.id} skipped: ${(error as Error).message}`,
      );

      return null;
    }
  }

  private patternOf(template: BankMessageTemplate): RegExp {
    const cached = this.compiled.get(template.id);

    if (cached?.source === template.pattern) return cached.pattern;

    const pattern = new RegExp(template.pattern, PATTERN_FLAGS);

    this.compiled.set(template.id, { source: template.pattern, pattern });

    return pattern;
  }

  private run(
    pattern: RegExp,
    text: string,
    timeoutMs: number,
  ): RegExpExecArray | null {
    if (text.length > MESSAGE_TEXT_MAX_LENGTH) return null;

    Object.assign(this.sandbox, { pattern, text });
    try {
      return this.execute.runInContext(this.sandbox, {
        timeout: timeoutMs,
      }) as RegExpExecArray | null;
    } finally {
      Object.assign(this.sandbox, { pattern: null, text: null });
    }
  }

  private amountOf(match: RegExpExecArray | null): Fiat | null {
    const raw = match?.groups?.amount;

    if (raw === undefined) return null;

    const normalized = raw.replace(AMOUNT_SPACES, '').replace(',', '.');

    return AMOUNT_SHAPE.test(normalized) ? toFiat(normalized) : null;
  }

  private assertValidPattern(pattern: string): void {
    try {
      new RegExp(pattern, PATTERN_FLAGS);
    } catch (error) {
      throw new BadRequestException(
        `The pattern is not a valid regular expression: ${(error as Error).message}`,
      );
    }

    const groups = new RegExp(`(?:${pattern})|`, PATTERN_FLAGS).exec(
      '',
    )?.groups;

    if (!groups || !(AMOUNT_GROUP in groups)) {
      throw new BadRequestException(
        'The pattern needs a named group "amount": (?<amount>…)',
      );
    }
  }

  private async assertBankExists(bankId: number): Promise<void> {
    if (!(await this.banks.findById(bankId))) {
      throw new BadRequestException(`Bank ${bankId} does not exist`);
    }
  }
}
