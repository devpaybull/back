import { detectFileMime } from '../utils/detect-file-mime';

const ftyp = (brand: string): Buffer =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from(`ftyp${brand}`, 'latin1'),
  ]);

describe('detectFileMime', () => {
  it.each([
    [Buffer.from('%PDF-1.7 rest'), 'application/pdf'],
    [
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      'image/png',
    ],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    [ftyp('heic'), 'image/heic'],
    [ftyp('mif1'), 'image/heif'],
    [ftyp('isom'), 'video/mp4'],
    [ftyp('qt  '), 'video/quicktime'],
    [ftyp('3gp5'), 'video/3gpp'],
    [Buffer.from('RIFF\0\0\0\0AVI LIST', 'latin1'), 'video/x-msvideo'],
    [Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82]), 'video/x-matroska'],
    [
      Buffer.concat([
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
        Buffer.from('webm'),
      ]),
      'video/webm',
    ],
    [Buffer.from([0, 0, 1, 0xba, 0]), 'video/mpeg'],
    [Buffer.from([0, 0, 1, 0xb3, 0]), 'video/mpeg'],
  ])('recognises %#', (content, mime) => {
    expect(detectFileMime(content)).toBe(mime);
  });

  it.each([
    [Buffer.from('<html><script>alert(1)</script>')],
    [Buffer.from('MZ\x90')],
    [Buffer.from('')],
    [ftyp('xxxx')],
    [Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1')],
    [Buffer.from(' %PDF-1.7')],
  ])('refuses content %#, whatever the file is called', (content) => {
    expect(detectFileMime(content)).toBeNull();
  });
});
