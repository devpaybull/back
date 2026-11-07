export const attachmentDisposition = (name: string): string =>
  `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`;
