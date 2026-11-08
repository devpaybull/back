import { Role } from '../src/common/enums/role.enum';
import { E2eContext, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

describe('the trader cabinet: the size of a receipt', () => {
  let e2e: E2eContext;

  beforeAll(async () => {
    e2e = await startE2e({ DISPUTE_FILE_MAX_BYTES: '16' });
  });

  afterAll(() => e2e?.close());

  it('answers 413 over DISPUTE_FILE_MAX_BYTES', async () => {
    const trader = await e2e.createUser(Role.Trader);

    await e2e.http
      .post('/trader/payouts/00000000-0000-4000-8000-000000000000/complete')
      .set(bearer(trader))
      .attach('file', Buffer.alloc(17), 'big.pdf')
      .expect(413);
  });
});
