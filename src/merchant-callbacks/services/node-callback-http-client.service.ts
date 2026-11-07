import { Injectable } from '@nestjs/common';
import { LookupFunction } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import {
  CallbackHttpClient,
  CallbackHttpResponse,
  CallbackUrlRefusedError,
} from '../types/callback-http-client';
import { assertPublicAddress } from '../utils/assert-public-address';

const RESPONSE_BODY_MAX_BYTES = 2048;
const HOST_BRACKETS = /^\[|\]$/g;

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 0);

      return;
    }

    try {
      addresses.forEach(({ address }) => assertPublicAddress(address));
    } catch (refused) {
      callback(refused as NodeJS.ErrnoException, '', 0);

      return;
    }

    if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
};

@Injectable()
export class NodeCallbackHttpClient extends CallbackHttpClient {
  async post(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<CallbackHttpResponse> {
    const target = this.parse(url);

    if (target.protocol !== 'https:') {
      throw new CallbackUrlRefusedError('The callback URL must be https');
    }

    const host = target.hostname.replace(HOST_BRACKETS, '');

    if (isIP(host)) assertPublicAddress(host);

    return new Promise((resolve, reject) => {
      const outgoing = request(
        target,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
          lookup: publicOnlyLookup,
          agent: false,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let kept = 0;

          response.on('data', (chunk: Buffer) => {
            if (kept < RESPONSE_BODY_MAX_BYTES) {
              chunks.push(chunk.subarray(0, RESPONSE_BODY_MAX_BYTES - kept));
              kept += chunk.length;
            }

            if (kept >= RESPONSE_BODY_MAX_BYTES) response.destroy();
          });

          const finish = () =>
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            });

          response.on('end', finish);
          response.on('close', finish);
          response.on('error', finish);
        },
      );

      const deadline = setTimeout(
        () => outgoing.destroy(new Error(`No answer within ${timeoutMs} ms`)),
        timeoutMs,
      );

      outgoing.on('close', () => clearTimeout(deadline));
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  }

  private parse(url: string): URL {
    try {
      return new URL(url);
    } catch {
      throw new CallbackUrlRefusedError('The callback URL cannot be read');
    }
  }
}
