import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { INT4_MAX } from '../utils/int4-max';

@Injectable()
export class StoredIdPipe implements PipeTransform<number, number> {
  constructor(private readonly what: string) {}

  transform(id: number): number {
    if (id < 1 || id > INT4_MAX) {
      throw new NotFoundException(`${this.what} not found`);
    }

    return id;
  }
}
