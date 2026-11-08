import { execFileSync } from 'child_process';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runId } from './run-id';

const stateFile = (): string =>
  join(tmpdir(), `paybull-e2e-postgres-${runId()}.json`);
const IMAGE = 'postgres:16-alpine';

export interface PostgresState {
  container: string;
  port: number;
}

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8' }).trim();

export const startPostgres = (): PostgresState => {
  const container = `paybull-e2e-${process.pid}`;
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    '-e',
    'POSTGRES_PASSWORD=e2e',
    '-e',
    'POSTGRES_DB=paybull_e2e',
    '-p',
    '127.0.0.1::5432',
    IMAGE,
  );
  const port = Number(docker('port', container, '5432/tcp').split(':').pop());

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker(
        'exec',
        container,
        'pg_isready',
        '-U',
        'postgres',
        '-d',
        'paybull_e2e',
      );
      docker(
        'exec',
        container,
        'psql',
        '-U',
        'postgres',
        '-d',
        'paybull_e2e',
        '-c',
        'select 1',
      );
      const state = { container, port };
      writeFileSync(stateFile(), JSON.stringify(state));
      return state;
    } catch {
      execFileSync('sleep', ['1']);
    }
  }

  throw new Error('Postgres did not start');
};

export const readPostgres = (): PostgresState =>
  JSON.parse(readFileSync(stateFile(), 'utf8')) as PostgresState;

export const stopPostgres = (): void => {
  try {
    docker('rm', '-f', readPostgres().container);
    rmSync(stateFile(), { force: true });
  } catch {
    return;
  }
};
