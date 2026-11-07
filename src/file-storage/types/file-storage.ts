import { Readable } from 'node:stream';

export abstract class FileStorage {
  abstract put(key: string, body: Buffer, mime: string): Promise<void>;
  abstract get(key: string): Promise<Readable>;
  abstract delete(key: string): Promise<void>;
}
