import { QRCodeErrorCorrectionLevel, toDataURL } from 'qrcode';

const PNG_DATA_URL_TYPE = 'image/png';
const RECOVERS_FROM_FIFTEEN_PERCENT_DAMAGE: QRCodeErrorCorrectionLevel = 'M';
const QUIET_ZONE_MODULES_REQUIRED_BY_THE_QR_SPEC = 4;

export function renderQrCodeDataUrl(text: string): Promise<string> {
  return toDataURL(text, {
    type: PNG_DATA_URL_TYPE,
    errorCorrectionLevel: RECOVERS_FROM_FIFTEEN_PERCENT_DAMAGE,
    margin: QUIET_ZONE_MODULES_REQUIRED_BY_THE_QR_SPEC,
  });
}
