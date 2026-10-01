import { WebSocket as EngineWebSocketTransport } from 'socket.io-client';

export type HappierWebSocketFactory = (uri: string, protocols?: string | string[], options?: Record<string, unknown>) => unknown;

/** Engine.IO retains lifecycle ownership; the carrier supplies only its byte socket. */
export function websocketFactoryTransport(factory: HappierWebSocketFactory): Array<new (options: unknown) => InstanceType<typeof EngineWebSocketTransport>> {
  return [class FactoryWebSocketTransport extends EngineWebSocketTransport {
    createSocket(uri: string, protocols: string | string[] | undefined, options: Record<string, unknown>) {
      return factory(uri, protocols, options);
    }
  }];
}
