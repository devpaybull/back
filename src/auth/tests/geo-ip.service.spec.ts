import { ConfigService } from '@nestjs/config';
import { open } from 'maxmind';
import { GeoIpService } from '../services/geo-ip.service';

jest.mock('maxmind', () => ({ open: jest.fn() }));

const openMock = open as unknown as jest.Mock;

describe('GeoIpService', () => {
  const reader = { get: jest.fn() };

  const serviceWith = async (path: string): Promise<GeoIpService> => {
    const service = new GeoIpService({
      get: () => path,
    } as unknown as ConfigService);

    await service.onModuleInit();

    return service;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    openMock.mockResolvedValue(reader);
    reader.get.mockReturnValue({ country: { iso_code: 'DE' } });
  });

  it('opens nothing and answers null when no path is configured', async () => {
    const service = await serviceWith('');

    expect(openMock).not.toHaveBeenCalled();
    expect(service.countryOf('8.8.8.8')).toBeNull();
  });

  it('boots and answers null when the file cannot be opened', async () => {
    openMock.mockRejectedValue(new Error('ENOENT'));

    const service = await serviceWith('/missing/dbip.mmdb');

    expect(openMock).toHaveBeenCalledWith('/missing/dbip.mmdb');
    expect(service.countryOf('8.8.8.8')).toBeNull();
  });

  it('answers the ISO code the reader finds for a public address', async () => {
    const service = await serviceWith('/data/dbip.mmdb');

    expect(service.countryOf('8.8.8.8')).toBe('DE');
    expect(reader.get).toHaveBeenCalledWith('8.8.8.8');
  });

  it.each([
    '10.0.0.5',
    '127.0.0.1',
    '172.16.4.1',
    '192.168.1.10',
    '169.254.1.1',
    '100.64.0.1',
    '::1',
    'fe80::1',
    'fd00::1',
    'not-an-ip',
  ])('does not look %s up', async (ip) => {
    const service = await serviceWith('/data/dbip.mmdb');

    expect(service.countryOf(ip)).toBeNull();
    expect(reader.get).not.toHaveBeenCalled();
  });

  it('unwraps an IPv4-mapped IPv6 address before looking it up', async () => {
    const service = await serviceWith('/data/dbip.mmdb');

    expect(service.countryOf('::ffff:8.8.8.8')).toBe('DE');
    expect(reader.get).toHaveBeenCalledWith('8.8.8.8');
  });

  it('does not look up a mapped private address', async () => {
    const service = await serviceWith('/data/dbip.mmdb');

    expect(service.countryOf('::ffff:192.168.0.1')).toBeNull();
    expect(reader.get).not.toHaveBeenCalled();
  });

  it('answers null for an address the database does not know', async () => {
    reader.get.mockReturnValue(null);
    const service = await serviceWith('/data/dbip.mmdb');

    expect(service.countryOf('8.8.8.8')).toBeNull();
  });

  it('answers null instead of throwing when the reader fails', async () => {
    reader.get.mockImplementation(() => {
      throw new Error('corrupt');
    });
    const service = await serviceWith('/data/dbip.mmdb');

    expect(service.countryOf('8.8.8.8')).toBeNull();
  });
});
