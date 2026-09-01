import { configuration } from '@/configuration';

import { resolveLoopbackHttpUrl } from './loopbackUrl';

type ServerHttpRuntimePublication = Readonly<{
  origin: string;
  carrier: 'iroh' | 'https';
}>;

let runtimePublication: ServerHttpRuntimePublication | null = null;

export function normalizeServerHttpBaseUrl(serverUrl: string): string {
  return resolveLoopbackHttpUrl(serverUrl).replace(/\/+$/, '');
}

export function resolveServerHttpBaseUrl(): string {
  return runtimePublication?.origin ?? normalizeServerHttpBaseUrl(configuration.apiServerUrl);
}

/**
 * Publishes the daemon's verified process-local destination without changing
 * the canonical Home URL used for identity, credentials, and auth audiences.
 * The daemon has one active Home, so the returned owner-bound release is the
 * complete lifecycle rather than a second profile or tunnel registry.
 */
export function publishServerHttpRuntimeOrigin(
  runtimeOrigin: string,
  carrier: 'iroh' | 'https',
): () => void {
  const publication = {
    origin: normalizeServerHttpBaseUrl(runtimeOrigin),
    carrier,
  } satisfies ServerHttpRuntimePublication;
  runtimePublication = publication;
  return () => {
    if (runtimePublication === publication) runtimePublication = null;
  };
}

export function resolveServerSocketIoTransports(): string[] | undefined {
  return runtimePublication?.carrier === 'iroh'
    ? ['websocket']
    : configuration.socketIoTransports;
}
