import { EntityManager } from 'typeorm';
import { TronOutgoingTransfer } from '../entities/tron-outgoing-transfer.entity';

export type OutgoingTransferHandler = (
  manager: EntityManager,
  transfer: TronOutgoingTransfer,
) => Promise<void>;
