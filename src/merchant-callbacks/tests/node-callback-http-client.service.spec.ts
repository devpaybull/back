import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { IncomingHttpHeaders, ServerResponse } from 'node:http';
import { createServer, Server } from 'node:https';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeCallbackHttpClient } from '../services/node-callback-http-client.service';
import { CallbackUrlRefusedError } from '../types/callback-http-client';
import { assertPublicAddress } from '../utils/assert-public-address';

jest.mock('../utils/assert-public-address');
jest.mock('node:https', () => {
  const actual = jest.requireActual<typeof import('node:https')>('node:https');

  return {
    ...actual,
    request: (url: URL, options: object, callback: () => void) =>
      actual.request(url, { ...options, rejectUnauthorized: false }, callback),
  };
});

const mockedAssert = jest.mocked(assertPublicAddress);

describe('NodeCallbackHttpClient', () => {
  const client = new NodeCallbackHttpClient();
  const post = (url: string) => client.post(url, '{}', {}, 1000);

  beforeEach(() => {
    mockedAssert.mockImplementation(
      jest.requireActual<{ assertPublicAddress: typeof assertPublicAddress }>(
        '../utils/assert-public-address',
      ).assertPublicAddress,
    );
  });

  it.each([
    'http://example.com/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[::ffff:7f00:1]/hook',
    'https://localhost:1/hook',
  ])('refuses %s without connecting', async (url) => {
    await expect(post(url)).rejects.toBeInstanceOf(CallbackUrlRefusedError);
  });
});

describe('NodeCallbackHttpClient against a live TLS server', () => {
  const directory = mkdtempSync(join(tmpdir(), 'callback-tls-'));
  let server: Server;
  let handler: (response: ServerResponse) => void;
  let received: { headers: IncomingHttpHeaders; body: string }[];
  const client = new NodeCallbackHttpClient();
  const post = (timeoutMs = 2000) =>
    client.post(
      `https://localhost:${(server.address() as AddressInfo).port}/hook`,
      '{"a":1}',
      { 'X-Test': 'yes' },
      timeoutMs,
    );

  beforeAll(async () => {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'ignore' },
    );
    server = createServer(
      {
        key: readFileSync(join(directory, 'key.pem')),
        cert: readFileSync(join(directory, 'cert.pem')),
      },
      (request, response) => {
        const chunks: Buffer[] = [];

        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          received.push({
            headers: request.headers,
            body: Buffer.concat(chunks).toString(),
          });
          handler(response);
        });
      },
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  beforeEach(() => {
    received = [];
    mockedAssert.mockImplementation(() => undefined);
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });

  it('posts the body and headers and returns the code and body', async () => {
    handler = (response) => {
      response.writeHead(201);
      response.end('thanks');
    };

    await expect(post()).resolves.toEqual({ statusCode: 201, body: 'thanks' });
    expect(received[0].body).toBe('{"a":1}');
    expect(received[0].headers['x-test']).toBe('yes');
  });

  it('does not follow a redirect', async () => {
    handler = (response) => {
      response.writeHead(302, { Location: 'https://localhost/elsewhere' });
      response.end();
    };

    await expect(post()).resolves.toMatchObject({ statusCode: 302 });
    expect(received).toHaveLength(1);
  });

  it('keeps at most 2 KB of a huge answer', async () => {
    handler = (response) => {
      response.writeHead(200);
      response.end(Buffer.alloc(5_000_000, 'x'));
    };

    const answer = await post();

    expect(answer.body.length).toBeLessThanOrEqual(2048);
  });

  it('cuts a silent server at the limit', async () => {
    handler = () => undefined;

    await expect(post(200)).rejects.toThrow('No answer within 200 ms');
  });

  it('cuts a dripping answer at the limit, whatever keeps arriving', async () => {
    const drips: NodeJS.Timeout[] = [];

    handler = (response) => {
      response.socket?.write('HTTP/1.1 200 OK\r\nX-Slow: ');
      drips.push(setInterval(() => response.socket?.write('a'), 30));
    };

    const started = Date.now();

    await expect(post(300)).rejects.toThrow('No answer within 300 ms');
    expect(Date.now() - started).toBeLessThan(1500);
    drips.forEach(clearInterval);
  });

  it('refuses a name that resolves to a private address, at connect time', async () => {
    mockedAssert.mockImplementation((address: string) => {
      throw new CallbackUrlRefusedError(`${address} is not public`);
    });

    await expect(post()).rejects.toBeInstanceOf(CallbackUrlRefusedError);
    expect(received).toEqual([]);
  });
});
