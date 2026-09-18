import type { AnyMessage, Stream } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import { createConnection } from 'node:net';
import { WebSocket } from 'ws';

import { createAcpNdJsonStream } from '../createAcpNdJsonStream';
import { nodeToWebStreams } from '../nodeToWebStreams';

export type AcpBackendNetworkTransport =
  | Readonly<{
      kind: 'webSocket';
      url: string;
      headers?: Readonly<Record<string, string>>;
    }>
  | Readonly<{
      kind: 'tcp';
      host: string;
      port: number;
    }>;

export type AcpNetworkStream = Stream & Readonly<{
  closeTransport(): void;
}>;

function observeMessageWrites(
  stream: Stream,
  onMessageWritten: (message: AnyMessage) => void,
): Stream {
  return {
    readable: stream.readable,
    writable: new WritableStream<AnyMessage>({
      async write(message) {
        const writer = stream.writable.getWriter();
        try {
          await writer.write(message);
          onMessageWritten(message);
        } finally {
          writer.releaseLock();
        }
      },
      async close() {
        await stream.writable.close();
      },
      async abort(reason) {
        await stream.writable.abort(reason);
      },
    }),
  };
}

export function createAcpNetworkStream(
  transport: AcpBackendNetworkTransport,
  options: Readonly<{ onMessageWritten: (message: AnyMessage) => void }>,
): AcpNetworkStream {
  if (transport.kind === 'webSocket') {
    const stream = createWebSocketStream(transport.url, {
      WebSocket,
      ...(transport.headers ? { headers: { ...transport.headers } } : {}),
    });
    return Object.assign(observeMessageWrites(stream, options.onMessageWritten), {
      // The SDK-owned WebSocket stream closes its socket with the connection.
      closeTransport() {},
    });
  }

  const socket = createConnection({ host: transport.host, port: transport.port });
  const streams = nodeToWebStreams(socket, socket);
  return Object.assign(createAcpNdJsonStream(streams.writable, streams.readable, options), {
    closeTransport() {
      socket.destroy();
    },
  });
}
