import { Role } from '../src/common/enums/role.enum';
import { Device } from '../src/devices/entities/device.entity';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

describe('device pairing and heartbeat', () => {
  let e2e: E2eContext;
  let trader: E2eUser;
  let stranger: E2eUser;

  const deviceBearer = (token: string) => ({
    Authorization: `Bearer ${token}`,
  });

  const createDevice = async (name: string): Promise<number> =>
    (
      await e2e.http
        .post('/devices')
        .set(bearer(trader))
        .send({ type: 'android', name })
        .expect(201)
    ).body.data.id;

  const issuePairing = async (id: number): Promise<string> => {
    const issued = await e2e.http
      .post(`/devices/${id}/pairing`)
      .set(bearer(trader))
      .expect(201);

    return JSON.parse(issued.body.data.qrPayload).pairingToken;
  };

  beforeAll(async () => {
    e2e = await startE2e();
    trader = await e2e.createUser(Role.Trader);
    stranger = await e2e.createUser(Role.Trader);
  });

  afterAll(() => e2e.close());

  it('pairs a device, keeps it online by heartbeat and shows it offline after silence', async () => {
    const id = await createDevice('Pixel 7');

    const fresh = await e2e.http
      .get(`/devices/${id}`)
      .set(bearer(trader))
      .expect(200);
    expect(fresh.body.data).toMatchObject({
      type: 'android',
      network: 'offline',
      activatedAt: null,
      requisiteCount: 0,
    });

    const issued = await e2e.http
      .post(`/devices/${id}/pairing`)
      .set(bearer(trader))
      .expect(201);
    const payload = JSON.parse(issued.body.data.qrPayload);
    expect(payload.deviceKey).toBe(fresh.body.data.key);
    expect(new Date(issued.body.data.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 9 * 60 * 1000,
    );

    await e2e.http
      .post(`/devices/${id}/pairing`)
      .set(bearer(stranger))
      .expect(404);

    const paired = await e2e.http
      .post('/device/pair')
      .send({
        pairingToken: payload.pairingToken,
        model: 'Google Pixel 7',
        appVersion: '1.0.0',
        phone: '+79161234567',
      })
      .expect(200);
    expect(paired.body.data).toEqual({
      deviceToken: expect.any(String),
      heartbeatSeconds: 30,
    });
    const deviceToken: string = paired.body.data.deviceToken;

    await e2e.http
      .post('/device/pair')
      .send({ pairingToken: payload.pairingToken })
      .expect(410);

    await e2e.dataSource
      .getRepository(Device)
      .update({ id }, { lastActivity: new Date(Date.now() - 10 * 60 * 1000) });
    expect(
      (await e2e.http.get(`/devices/${id}`).set(bearer(trader)).expect(200))
        .body.data.network,
    ).toBe('offline');

    const beat = await e2e.http
      .post('/device/heartbeat')
      .set(deviceBearer(deviceToken))
      .send({ appVersion: '1.0.1' })
      .expect(200);
    expect(beat.body.data).toEqual({ heartbeatSeconds: 30 });

    const online = await e2e.http
      .get(`/devices/${id}`)
      .set(bearer(trader))
      .expect(200);
    expect(online.body.data).toMatchObject({
      network: 'online',
      model: 'Google Pixel 7',
      phone: '+79161234567',
      appVersion: '1.0.1',
      activatedAt: expect.any(String),
    });

    const counts = await e2e.http
      .get('/devices/counts')
      .set(bearer(trader))
      .expect(200);
    expect(counts.body.data).toEqual({ total: 1, online: 1, offline: 0 });

    await e2e.dataSource
      .getRepository(Device)
      .update({ id }, { lastActivity: new Date(Date.now() - 121 * 1000) });

    expect(
      (await e2e.http.get(`/devices/${id}`).set(bearer(trader)).expect(200))
        .body.data.network,
    ).toBe('offline');
    expect(
      (await e2e.http.get('/devices/counts').set(bearer(trader)).expect(200))
        .body.data,
    ).toEqual({ total: 1, online: 0, offline: 1 });
  });

  it('lets the owner edit the type, name, model and phone, and nothing the app owns', async () => {
    const id = await createDevice('Old name');

    const patched = await e2e.http
      .patch(`/devices/${id}`)
      .set(bearer(trader))
      .send({
        name: 'Work phone',
        model: 'Redmi Note 12',
        phone: '+77011234567',
      })
      .expect(200);
    expect(patched.body.data).toMatchObject({
      name: 'Work phone',
      model: 'Redmi Note 12',
      phone: '+77011234567',
    });

    await e2e.http
      .patch(`/devices/${id}`)
      .set(bearer(trader))
      .send({ appVersion: '9.9.9' })
      .expect(400);
    await e2e.http
      .patch(`/devices/${id}`)
      .set(bearer(trader))
      .send({ type: 'ios' })
      .expect(400);
  });

  it('voids the previous QR code when a new one is issued', async () => {
    const id = await createDevice('Refreshed');
    const first = await issuePairing(id);
    const second = await issuePairing(id);

    await e2e.http
      .post('/device/pair')
      .send({ pairingToken: first })
      .expect(401);
    await e2e.http
      .post('/device/pair')
      .send({ pairingToken: second })
      .expect(200);
  });

  it('refuses an expired QR code with 410', async () => {
    const id = await createDevice('Expired');
    const token = await issuePairing(id);

    await e2e.dataSource.query(
      `UPDATE "device_pairings" SET "expiresAt" = now() - interval '1 second' WHERE "deviceId" = $1`,
      [id],
    );

    await e2e.http
      .post('/device/pair')
      .send({ pairingToken: token })
      .expect(410);
  });

  it('revokes the earlier device token when the device pairs again', async () => {
    const id = await createDevice('Re-paired');
    const first = (
      await e2e.http
        .post('/device/pair')
        .send({ pairingToken: await issuePairing(id) })
        .expect(200)
    ).body.data.deviceToken;
    const second = (
      await e2e.http
        .post('/device/pair')
        .send({ pairingToken: await issuePairing(id) })
        .expect(200)
    ).body.data.deviceToken;

    await e2e.http
      .post('/device/heartbeat')
      .set(deviceBearer(first))
      .expect(401);
    await e2e.http
      .post('/device/heartbeat')
      .set(deviceBearer(second))
      .expect(200);
  });

  it('answers 401 to the token of a deleted device and to no token at all', async () => {
    const id = await createDevice('Deleted');
    const deviceToken = (
      await e2e.http
        .post('/device/pair')
        .send({ pairingToken: await issuePairing(id) })
        .expect(200)
    ).body.data.deviceToken;
    const unused = await issuePairing(id);

    await e2e.http.delete(`/devices/${id}`).set(bearer(trader)).expect(200);

    await e2e.http
      .post('/device/heartbeat')
      .set(deviceBearer(deviceToken))
      .expect(401);
    await e2e.http
      .post('/device/pair')
      .send({ pairingToken: unused })
      .expect(401);
    await e2e.http.post('/device/heartbeat').expect(401);
    await e2e.http.post('/device/heartbeat').set(bearer(trader)).expect(401);
  });
});
