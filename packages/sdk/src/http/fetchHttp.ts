import type { HttpExchange, HttpResponseBody } from './httpExchange.js';

export function createHttpExchange(): HttpExchange {
  // Finalizers may outlive the root request signal during its cleanup grace.
  // Closing the exchange must terminate them, like destroying Node's Agent.
  const controller = new AbortController();
  return {
    async request(url, options) {
      const signal = options.signal === undefined
        ? controller.signal : AbortSignal.any([options.signal, controller.signal]);
      const response = await fetch(url, { ...options, signal });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => { headers[name] = value; });
      const reader = response.body?.getReader();
      const body: HttpResponseBody = {
        destroy() {
          if (reader) void reader.cancel().catch(() => undefined).finally(() => reader.releaseLock());
        },
        async *[Symbol.asyncIterator]() {
          if (!reader) return;
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) return;
              yield chunk.value;
            }
          } finally {
            reader.releaseLock();
          }
        },
      };
      return { statusCode: response.status, headers, body };
    },
    async close() { controller.abort(); },
  };
}
