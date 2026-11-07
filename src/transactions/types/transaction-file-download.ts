import { Readable } from 'node:stream';
import { TransactionFile } from '../entities/transaction-file.entity';

export interface TransactionFileDownload {
  file: TransactionFile;
  body: Readable;
}
