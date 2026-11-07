export interface CallbackHttpResponse {
  statusCode: number;
  body: string;
}

export class CallbackUrlRefusedError extends Error {}

export abstract class CallbackHttpClient {
  abstract post(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<CallbackHttpResponse>;
}
