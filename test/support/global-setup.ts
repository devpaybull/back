import { runId } from './run-id';
import { startMinio } from './minio';
import { startPostgres } from './postgres';

export default (): void => {
  runId();
  startPostgres();
  startMinio();
};
