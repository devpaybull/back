import { execFileSync } from 'child_process';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runId } from './run-id';

const stateFile = (): string =>
  join(tmpdir(), `paybull-e2e-minio-${runId()}.json`);
const IMAGE =
  'ghcr.io/coollabsio/minio@sha256:69b55a1c1c5dc285ce04db96689f5b2102317fc77a50680a1874ca6efd1c87f9';

export const MINIO_USER = 'paybull-e2e';
export const MINIO_PASSWORD = 'paybull-e2e-secret';

interface MinioState {
  container: string;
  port: number;
}

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8' }).trim();

export const readMinio = (): MinioState =>
  JSON.parse(readFileSync(stateFile(), 'utf8')) as MinioState;

export const startMinio = (): void => {
  const container = `paybull-e2e-minio-${process.pid}`;

  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    '-e',
    `MINIO_ROOT_USER=${MINIO_USER}`,
    '-e',
    `MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}`,
    '-p',
    '127.0.0.1::9000',
    IMAGE,
    'server',
    '/data',
  );
  const port = Number(docker('port', container, '9000/tcp').split(':').pop());

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      execFileSync('curl', [
        '-sf',
        '-m',
        '2',
        `http://127.0.0.1:${port}/minio/health/live`,
      ]);
      writeFileSync(stateFile(), JSON.stringify({ container, port }));
      return;
    } catch {
      execFileSync('sleep', ['1']);
    }
  }

  throw new Error('MinIO did not start');
};

export const stopMinio = (): void => {
  try {
    docker('rm', '-f', readMinio().container);
    rmSync(stateFile(), { force: true });
  } catch {
    return;
  }
};
