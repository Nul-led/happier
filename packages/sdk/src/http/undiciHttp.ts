import { Agent, request } from 'undici';
import type { HttpExchange } from './httpExchange.js';

export function createHttpExchange(): HttpExchange {
  const dispatcher = new Agent();
  return {
    request: async (url, options) => await request(url, {
      ...options,
      dispatcher,
      // A valid Session Action can outlast Node fetch's hidden header deadline.
      // Caller cancellation remains the SDK deadline.
      headersTimeout: 0,
    }),
    close: async () => { await dispatcher.destroy(); },
  };
}
