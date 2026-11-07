import { startMinio } from './minio';
import { startPostgres } from './postgres';

export default (): void => {
  startPostgres();
  startMinio();
};
