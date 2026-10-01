/** Platform adapters share one response reader and error policy in connect.ts. */
export type HttpResponseBody = AsyncIterable<Uint8Array> & Readonly<{
  once?: (event: 'error', listener: (error: Error) => void) => unknown;
  destroy: () => unknown;
}>;

export type HttpResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: HttpResponseBody;
}>;

export type HttpExchange = Readonly<{
  request: (url: URL, options: Readonly<{
    method: 'GET' | 'POST';
    headers: Readonly<Record<string, string>>;
    body?: string;
    signal?: AbortSignal;
  }>) => Promise<HttpResponse>;
  close: () => Promise<void>;
}>;
