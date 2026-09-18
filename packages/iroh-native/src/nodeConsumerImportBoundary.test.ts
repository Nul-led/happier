import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  classifyIrohHomeCarrierFailure,
  IrohError,
  readIrohRelayConfigFromEnv,
  type IrohHomeCarrierFailureClassification,
} from './nodeNative.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const NODE_BUNDLE_CONSUMERS = [
  'apps/server/sources/app/iroh/homeIrohEndpoint.ts',
  'apps/server/sources/app/iroh/homeIrohEndpointConfig.ts',
  'apps/server/sources/app/iroh/homeIrohNativeLifecycle.ts',
  'apps/cli/src/ephemeralRunner/runtimeIntegrations.ts',
  'apps/cli/src/auth/terminalAuthEnrollmentRuntime.ts',
  'apps/cli/src/daemon/peer/iroh/daemonHomeIrohTransport.ts',
  'apps/cli/src/daemon/startDaemon.ts',
] as const;

describe('Iroh Node/Bun bundle import boundary', () => {
  it('keeps server and daemon bundle consumers on the Node-only package entry', async () => {
    const sources = await Promise.all(
      NODE_BUNDLE_CONSUMERS.map(async (relativePath) => ({
        relativePath,
        source: await readFile(resolve(repoRoot, relativePath), 'utf8'),
      })),
    );

    for (const { relativePath, source } of sources) {
      expect(source, relativePath).not.toMatch(
        /from\s+['"]@happier-dev\/iroh-native['"]/u,
      );
      expect(source, relativePath).toContain("from '@happier-dev/iroh-native/node'");
    }
  });

  it('exposes the shared failure and relay owners without the React Native root entry', () => {
    const classification: IrohHomeCarrierFailureClassification = classifyIrohHomeCarrierFailure(
      new IrohError('unavailable', 'native unavailable'),
    );

    expect(classification).toEqual({
      fallbackAllowed: true,
      failureClass: 'carrier-unavailable',
    });
    expect(readIrohRelayConfigFromEnv({})).toEqual({
      relayPolicy: 'automatic',
      relayUrls: [],
      explicitlyConfigured: false,
    });
  });
});
