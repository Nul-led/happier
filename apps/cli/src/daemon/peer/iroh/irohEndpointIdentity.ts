import { join } from 'node:path';

/**
 * One installation-scoped native Iroh identity for every CLI process role.
 * Auth helpers and daemon startup must resolve this owner instead of choosing
 * their own key path or silently creating a keyless endpoint.
 */
export function resolveCliIrohEndpointKeyPath(happyHomeDir: string): string {
  const dataRoot = String(happyHomeDir ?? '').trim();
  if (!dataRoot) throw new Error('Happier home directory is required for the Iroh endpoint identity');
  return join(dataRoot, 'runtime', 'iroh', 'endpoint.key');
}
