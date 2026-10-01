import { join } from 'node:path';

/**
 * The daemon's installation-scoped Machine service identity survives restarts.
 * Account-client helpers borrow its Home leases in-process or use independent
 * ephemeral endpoints; they must never register this identity in another process.
 */
export function resolveCliIrohEndpointKeyPath(happyHomeDir: string): string {
  const dataRoot = String(happyHomeDir ?? '').trim();
  if (!dataRoot) throw new Error('Happier home directory is required for the Iroh endpoint identity');
  return join(dataRoot, 'runtime', 'iroh', 'endpoint.key');
}
