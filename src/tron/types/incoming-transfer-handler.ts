import { EntityManager } from 'typeorm';
import { TronAddress } from '../entities/tron-address.entity';
import { UsdtTransferEvent } from './usdt-transfer-event';

export type IncomingTransferHandler = (
  manager: EntityManager,
  event: UsdtTransferEvent,
  address: TronAddress,
) => Promise<void>;
