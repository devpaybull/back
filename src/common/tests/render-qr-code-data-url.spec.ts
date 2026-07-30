import { renderQrCodeDataUrl } from '../utils/render-qr-code-data-url';

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const otpauthUrl =
  'otpauth://totp/Paybull:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Paybull';

const bytesOf = (dataUrl: string): Buffer =>
  Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64');

describe('renderQrCodeDataUrl', () => {
  it('renders a PNG data URI', async () => {
    const dataUrl = await renderQrCodeDataUrl(otpauthUrl);

    expect(dataUrl.startsWith(PNG_DATA_URL_PREFIX)).toBe(true);
  });

  it('encodes bytes that begin with the PNG signature', async () => {
    const bytes = bytesOf(await renderQrCodeDataUrl(otpauthUrl));

    expect([...bytes.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
  });

  it('renders the same input identically twice', async () => {
    const [first, second] = await Promise.all([
      renderQrCodeDataUrl(otpauthUrl),
      renderQrCodeDataUrl(otpauthUrl),
    ]);

    expect(first).toBe(second);
  });

  it('renders different inputs differently', async () => {
    const [ofOneSecret, ofAnotherSecret] = await Promise.all([
      renderQrCodeDataUrl(otpauthUrl),
      renderQrCodeDataUrl(otpauthUrl.replace('JBSWY3DPEHPK3PXP', 'NBSWY3DPEB')),
    ]);

    expect(ofOneSecret).not.toBe(ofAnotherSecret);
  });
});
