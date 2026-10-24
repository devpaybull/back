import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { WriteUserNoteDto } from '../dto/write-user-note.dto';

const parse = (payload: Record<string, unknown>) => {
  const dto = plainToInstance(WriteUserNoteDto, payload);
  return { dto, failed: validateSync(dto).map((e) => e.property) };
};

describe('WriteUserNoteDto', () => {
  it('accepts a text and trims it', () => {
    const { dto, failed } = parse({ text: '  hello\nworld  ' });

    expect(failed).toEqual([]);
    expect(dto.text).toBe('hello\nworld');
  });

  it('refuses an empty text', () => {
    expect(parse({ text: '' }).failed).toEqual(['text']);
  });

  it('refuses a text of only whitespace', () => {
    expect(parse({ text: '   \n ' }).failed).toEqual(['text']);
  });

  it('refuses a missing or non-string text', () => {
    expect(parse({}).failed).toEqual(['text']);
    expect(parse({ text: 5 }).failed).toEqual(['text']);
  });

  it('accepts 2000 characters and refuses 2001', () => {
    expect(parse({ text: 'a'.repeat(2000) }).failed).toEqual([]);
    expect(parse({ text: 'a'.repeat(2001) }).failed).toEqual(['text']);
  });
});
