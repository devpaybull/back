import {
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, MoreThan, MoreThanOrEqual } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { DevicesService } from '../devices.service';
import { DeviceCredential } from '../entities/device-credential.entity';
import { DevicePairing } from '../entities/device-pairing.entity';
import { Device } from '../entities/device.entity';
import { DevicePairingPayload } from '../types/device-pairing-payload';

describe('DevicesService — pairing, device tokens and the online window', () => {
  const owner = uuidOf(1);
  const now = new Date('2026-11-04T12:00:00.000Z');
  const settings: Record<string, number> = {
    DEVICE_PAIRING_TTL_MINUTES: 10,
    DEVICE_HEARTBEAT_SECONDS: 30,
    DEVICE_ONLINE_WINDOW_SECONDS: 120,
  };

  const device = { id: 100, key: uuidOf(500), userId: owner } as Device;

  const pairingsTx = {
    delete: jest.fn(async () => ({ affected: 1 })),
    create: jest.fn((data: Partial<DevicePairing>) => data),
    save: jest.fn(async (row: Partial<DevicePairing>) => ({ ...row, id: 7 })),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const credentialsTx = {
    update: jest.fn(async () => ({ affected: 1 })),
    create: jest.fn((data: Partial<DeviceCredential>) => data),
    save: jest.fn(async (row: Partial<DeviceCredential>) => row),
  };
  const devicesTx = { update: jest.fn(async () => ({ affected: 1 })) };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === DevicePairing
        ? pairingsTx
        : entity === DeviceCredential
          ? credentialsTx
          : devicesTx,
    ),
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) =>
      work(manager),
    ),
  };
  const devices = {
    manager,
    findOne: jest.fn(),
    find: jest.fn(async () => [{ id: 100 }]),
    count: jest.fn(async () => 0),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const pairings = { findOne: jest.fn() };
  const credentials = { findOne: jest.fn() };
  const audit = { record: jest.fn(async () => undefined) };

  let service: DevicesService;

  const pairing = (overrides: Partial<DevicePairing> = {}): DevicePairing =>
    ({
      id: 7,
      deviceId: 100,
      device,
      tokenHash: sha256Hex('the-token'),
      expiresAt: new Date(now.getTime() + 60_000),
      usedAt: null,
      ...overrides,
    }) as DevicePairing;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate'] });
    devices.findOne.mockResolvedValue(device);
    pairings.findOne.mockResolvedValue(pairing());
    pairingsTx.update.mockResolvedValue({ affected: 1 });

    const module = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: getRepositoryToken(Device), useValue: devices },
        { provide: getRepositoryToken(DevicePairing), useValue: pairings },
        {
          provide: getRepositoryToken(DeviceCredential),
          useValue: credentials,
        },
        { provide: AuditService, useValue: audit },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => settings[key]) },
        },
      ],
    }).compile();

    service = module.get(DevicesService);
  });

  afterEach(() => jest.useRealTimers());

  describe('issuePairing', () => {
    it('answers 404 for a device the caller does not own', async () => {
      devices.findOne.mockResolvedValue(null);

      await expect(service.issuePairing(100, uuidOf(2))).rejects.toThrow(
        NotFoundException,
      );
      expect(pairingsTx.save).not.toHaveBeenCalled();
    });

    it('voids the previous unused QR code before issuing a new one', async () => {
      await service.issuePairing(100, owner);

      expect(pairingsTx.delete).toHaveBeenCalledWith({
        deviceId: 100,
        usedAt: IsNull(),
      });
      expect(pairingsTx.delete.mock.invocationCallOrder[0]).toBeLessThan(
        pairingsTx.save.mock.invocationCallOrder[0],
      );
    });

    it('encodes the device key and the token, and stores only the hash', async () => {
      const issued = await service.issuePairing(100, owner);
      const payload = JSON.parse(issued.qrPayload) as DevicePairingPayload;

      expect(payload.deviceKey).toBe(uuidOf(500));
      expect(payload.pairingToken.length).toBeGreaterThanOrEqual(43);
      expect(pairingsTx.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 100,
          tokenHash: sha256Hex(payload.pairingToken),
        }),
      );
      expect(JSON.stringify(pairingsTx.create.mock.calls)).not.toContain(
        payload.pairingToken,
      );
    });

    it('expires after DEVICE_PAIRING_TTL_MINUTES', async () => {
      const issued = await service.issuePairing(100, owner);

      expect(issued.expiresAt).toEqual(new Date('2026-11-04T12:10:00.000Z'));
    });

    it('records who issued it', async () => {
      await service.issuePairing(100, owner, uuidOf(5));

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: owner,
          impersonatorUserId: uuidOf(5),
          action: 'device.pairing_issued',
        }),
        manager,
      );
    });
  });

  describe('pair', () => {
    it('looks the token up by its hash', async () => {
      await service.pair({ pairingToken: 'the-token' });

      expect(pairings.findOne).toHaveBeenCalledWith({
        where: { tokenHash: sha256Hex('the-token') },
        relations: { device: true },
      });
    });

    it('answers 401 for a token nobody issued', async () => {
      pairings.findOne.mockResolvedValue(null);

      await expect(service.pair({ pairingToken: 'unknown' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('answers 401 for the token of a deleted device', async () => {
      pairings.findOne.mockResolvedValue(pairing({ device: null }));

      await expect(service.pair({ pairingToken: 'the-token' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('answers 410 for a token already used', async () => {
      pairings.findOne.mockResolvedValue(pairing({ usedAt: now }));

      await expect(service.pair({ pairingToken: 'the-token' })).rejects.toThrow(
        GoneException,
      );
      expect(credentialsTx.save).not.toHaveBeenCalled();
    });

    it('answers 410 for an expired token', async () => {
      pairings.findOne.mockResolvedValue(pairing({ expiresAt: now }));

      await expect(service.pair({ pairingToken: 'the-token' })).rejects.toThrow(
        GoneException,
      );
    });

    it('answers 410 when a concurrent pair spent the token first', async () => {
      pairingsTx.update.mockResolvedValue({ affected: 0 });

      await expect(service.pair({ pairingToken: 'the-token' })).rejects.toThrow(
        GoneException,
      );
      expect(credentialsTx.save).not.toHaveBeenCalled();
    });

    it('spends the token only while it is still unused and unexpired', async () => {
      await service.pair({ pairingToken: 'the-token' });

      expect(pairingsTx.update).toHaveBeenCalledWith(
        { id: 7, usedAt: IsNull(), expiresAt: MoreThan(now) },
        { usedAt: now },
      );
    });

    it('revokes the earlier device tokens and stores the new one as a hash', async () => {
      const paired = await service.pair({ pairingToken: 'the-token' });

      expect(credentialsTx.update).toHaveBeenCalledWith(
        { deviceId: 100, revokedAt: IsNull() },
        { revokedAt: now },
      );
      expect(credentialsTx.create).toHaveBeenCalledWith({
        deviceId: 100,
        tokenHash: sha256Hex(paired.deviceToken),
        revokedAt: null,
      });
      expect(paired).toEqual({
        deviceToken: expect.any(String),
        heartbeatSeconds: 30,
      });
    });

    it('activates the device and takes what the app reports', async () => {
      await service.pair({
        pairingToken: 'the-token',
        model: 'Google Pixel 7',
        appVersion: '1.0.0',
        phone: '+79161234567',
      });

      expect(devicesTx.update).toHaveBeenCalledWith(
        { id: 100 },
        {
          activatedAt: now,
          lastActivity: now,
          model: 'Google Pixel 7',
          appVersion: '1.0.0',
          phone: '+79161234567',
        },
      );
    });

    it('leaves what the app did not report alone', async () => {
      await service.pair({ pairingToken: 'the-token' });

      expect(devicesTx.update).toHaveBeenCalledWith(
        { id: 100 },
        { activatedAt: now, lastActivity: now },
      );
    });
  });

  describe('authenticate', () => {
    it('accepts only an unrevoked token, looked up by its hash', async () => {
      credentials.findOne.mockResolvedValue({ device });

      await expect(service.authenticate('device-token')).resolves.toBe(device);
      expect(credentials.findOne).toHaveBeenCalledWith({
        where: { tokenHash: sha256Hex('device-token'), revokedAt: IsNull() },
        relations: { device: true },
      });
    });

    it('refuses a token whose device was deleted', async () => {
      credentials.findOne.mockResolvedValue({ device: null });

      await expect(service.authenticate('device-token')).resolves.toBeNull();
    });

    it('refuses a token nobody holds', async () => {
      credentials.findOne.mockResolvedValue(null);

      await expect(service.authenticate('device-token')).resolves.toBeNull();
    });
  });

  describe('the online window', () => {
    it('starts DEVICE_ONLINE_WINDOW_SECONDS before now', () => {
      expect(service.onlineSince()).toEqual(
        new Date('2026-11-04T11:58:00.000Z'),
      );
    });

    it('picks the online devices by their last heartbeat', async () => {
      await expect(service.onlineDeviceIds([100, 101])).resolves.toEqual([100]);
      expect(devices.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lastActivity: MoreThanOrEqual(new Date('2026-11-04T11:58:00.000Z')),
          }),
        }),
      );
    });

    it('asks nothing for an empty list', async () => {
      await expect(service.onlineDeviceIds([])).resolves.toEqual([]);
      expect(devices.find).not.toHaveBeenCalled();
    });

    it('counts total, online and offline for the owner', async () => {
      devices.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

      await expect(service.countsOf(owner)).resolves.toEqual({
        total: 5,
        online: 2,
        offline: 3,
      });
    });

    it('moves lastActivity on a heartbeat and keeps a reported version', async () => {
      await service.heartbeat(100, '1.0.1');

      expect(devices.update).toHaveBeenCalledWith(
        { id: 100 },
        { lastActivity: now, appVersion: '1.0.1' },
      );
    });
  });
});
