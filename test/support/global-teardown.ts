import { stopMinio } from './minio';
import { stopPostgres } from './postgres';

export default (): void => {
  stopPostgres();
  stopMinio();
};
