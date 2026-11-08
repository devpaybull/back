const RUN_ID_VARIABLE = 'PAYBULL_E2E_RUN';

export const runId = (): string => {
  process.env[RUN_ID_VARIABLE] ??= String(process.pid);

  return process.env[RUN_ID_VARIABLE];
};
