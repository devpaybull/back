const startsWith = (
  buffer: Buffer,
  bytes: readonly number[],
  at = 0,
): boolean => bytes.every((byte, index) => buffer[at + index] === byte);

const ascii = (buffer: Buffer, from: number, to: number): string =>
  buffer.subarray(from, to).toString('latin1');

const FTYP_OFFSET = 4;
const BRAND_OFFSET = 8;
const BRAND_END = 12;
const EBML_DOCTYPE_SCAN_BYTES = 4096;

const FTYP_MIME: Record<string, string> = {
  heic: 'image/heic',
  heix: 'image/heic',
  hevc: 'image/heic',
  mif1: 'image/heif',
  msf1: 'image/heif',
  heif: 'image/heif',
  'qt  ': 'video/quicktime',
  '3gp4': 'video/3gpp',
  '3gp5': 'video/3gpp',
  '3gp6': 'video/3gpp',
  '3gp7': 'video/3gpp',
  '3g2a': 'video/3gpp',
  isom: 'video/mp4',
  iso2: 'video/mp4',
  iso4: 'video/mp4',
  iso5: 'video/mp4',
  iso6: 'video/mp4',
  mp41: 'video/mp4',
  mp42: 'video/mp4',
  avc1: 'video/mp4',
  'M4V ': 'video/mp4',
  dash: 'video/mp4',
};

export function detectFileMime(buffer: Buffer): string | null {
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf';
  }

  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  if (ascii(buffer, FTYP_OFFSET, BRAND_OFFSET) === 'ftyp') {
    return FTYP_MIME[ascii(buffer, BRAND_OFFSET, BRAND_END)] ?? null;
  }

  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'AVI ') {
    return 'video/x-msvideo';
  }

  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return ascii(buffer, 0, EBML_DOCTYPE_SCAN_BYTES).includes('webm')
      ? 'video/webm'
      : 'video/x-matroska';
  }

  if (
    startsWith(buffer, [0x00, 0x00, 0x01, 0xba]) ||
    startsWith(buffer, [0x00, 0x00, 0x01, 0xb3])
  ) {
    return 'video/mpeg';
  }

  return null;
}
