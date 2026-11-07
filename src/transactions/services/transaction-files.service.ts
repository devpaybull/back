import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { FileStorage } from '../../file-storage/types/file-storage';
import { TransactionFile } from '../entities/transaction-file.entity';
import { Transaction } from '../entities/transaction.entity';
import { StoredUpload } from '../types/stored-upload';
import { TransactionFileKind } from '../types/transaction-file-kind.enum';
import { TransactionFileDownload } from '../types/transaction-file-download';
import { TransactionUpload } from '../types/transaction-upload';
import { dealNotFound } from '../utils/deal-not-found';
import { detectFileMime } from '../utils/detect-file-mime';

const FILE_NAME_MAX = 255;
const DISPUTE_MAX_AGE_MS = 14 * 86_400_000;
const DISPUTE_UNATTACHED_FILES_MAX = 5;
const FIRST_PRINTABLE_CODE = 0x20;
const DELETE_CODE = 0x7f;

const withoutControlCharacters = (name: string): string =>
  [...name]
    .filter((character) => {
      const code = character.charCodeAt(0);

      return code >= FIRST_PRINTABLE_CODE && code !== DELETE_CODE;
    })
    .join('');

@Injectable()
export class TransactionFilesService {
  private readonly logger = new Logger(TransactionFilesService.name);

  constructor(
    @InjectRepository(TransactionFile)
    private readonly files: Repository<TransactionFile>,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    private readonly storage: FileStorage,
  ) {}

  async store(
    transactionId: string,
    upload: TransactionUpload,
  ): Promise<StoredUpload> {
    const mime = detectFileMime(upload.buffer);

    if (!mime) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'FILE_TYPE_NOT_ALLOWED',
        message: 'This file type is not accepted',
      });
    }

    const storageKey = `deals/${transactionId}/${randomUUID()}`;

    await this.storage.put(storageKey, upload.buffer, mime);

    return {
      storageKey,
      mime,
      size: upload.buffer.length,
      name: withoutControlCharacters(upload.name).slice(0, FILE_NAME_MAX),
    };
  }

  async discard(stored: StoredUpload): Promise<void> {
    try {
      await this.storage.delete(stored.storageKey);
    } catch (error) {
      this.logger.error(
        `Could not delete ${stored.storageKey}: ${(error as Error).message}`,
      );
    }
  }

  recordWithin(
    manager: EntityManager,
    transactionId: string,
    kind: TransactionFileKind,
    stored: StoredUpload,
    uploadedByUserId: string | null,
    disputeId: number | null = null,
  ): Promise<TransactionFile> {
    return manager.save(
      manager.create(TransactionFile, {
        ...stored,
        transactionId,
        kind,
        uploadedByUserId,
        disputeId,
      }),
    );
  }

  listOf(transactionIds: string[]): Promise<TransactionFile[]> {
    if (transactionIds.length === 0) return Promise.resolve([]);

    return this.files.find({
      where: { transactionId: In(transactionIds) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async downloadForTrader(
    traderUserId: string,
    id: string,
  ): Promise<TransactionFileDownload> {
    const file = await this.files.findOne({ where: { id } });
    const deal =
      file &&
      (await this.transactions.findOne({
        select: { id: true },
        where: { id: file.transactionId, traderUserId },
      }));

    if (!file || !deal) throw new NotFoundException('File not found');

    return { file, body: await this.storage.get(file.storageKey) };
  }

  async uploadForMerchant(
    merchantId: string,
    transactionId: string,
    upload: TransactionUpload,
  ): Promise<TransactionFile> {
    const deal = await this.transactions.findOne({
      select: { id: true, createdAt: true },
      where: { id: transactionId, merchantId },
    });

    if (!deal) throw dealNotFound();

    if (Date.now() - deal.createdAt.getTime() > DISPUTE_MAX_AGE_MS) {
      throw new ConflictException({
        statusCode: 409,
        code: 'DISPUTE_NOT_ALLOWED',
        message: 'A deal this old cannot be disputed',
      });
    }

    const unattached = await this.files.count({
      where: {
        transactionId,
        kind: TransactionFileKind.DisputeReceipt,
        disputeId: IsNull(),
      },
    });

    if (unattached >= DISPUTE_UNATTACHED_FILES_MAX) {
      throw new ConflictException({
        statusCode: 409,
        code: 'DISPUTE_NOT_ALLOWED',
        message: 'This deal already has enough unused files',
      });
    }

    const stored = await this.store(transactionId, upload);

    try {
      return await this.recordWithin(
        this.files.manager,
        transactionId,
        TransactionFileKind.DisputeReceipt,
        stored,
        null,
      );
    } catch (error) {
      await this.discard(stored);
      throw error;
    }
  }

  async downloadForMerchant(
    merchantId: string,
    id: string,
  ): Promise<TransactionFileDownload> {
    const file = await this.files.findOne({
      where: { id, kind: TransactionFileKind.DisputeReceipt },
    });
    const deal =
      file &&
      (await this.transactions.findOne({
        select: { id: true },
        where: { id: file.transactionId, merchantId },
      }));

    if (!file || !deal) throw dealNotFound('File not found');

    return { file, body: await this.storage.get(file.storageKey) };
  }

  async download(
    transactionId: string,
    id: string,
  ): Promise<TransactionFileDownload> {
    const file = await this.files.findOne({ where: { id, transactionId } });

    if (!file) throw new NotFoundException('File not found');

    return { file, body: await this.storage.get(file.storageKey) };
  }
}
