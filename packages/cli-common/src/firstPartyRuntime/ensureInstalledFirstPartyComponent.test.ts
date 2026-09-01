import { describe, expect, it, vi } from 'vitest';

import type { InstalledFirstPartyComponentPaths } from './resolveInstalledComponentPaths.js';
import { ensureInstalledFirstPartyComponent } from './ensureInstalledFirstPartyComponent.js';

function createPaths(payloadRoot: string): InstalledFirstPartyComponentPaths {
  return {
    installRoot: '/managed/mutagen-engine',
    currentPath: payloadRoot,
    previousPath: '/managed/mutagen-engine/previous',
    versionsDir: '/managed/mutagen-engine/versions',
    binaryPath: `${payloadRoot}/mutagen`,
    nodeEntrypointPath: null,
    shimPaths: [],
    resolvedCurrentPath: payloadRoot,
    resolvedBinaryPath: `${payloadRoot}/mutagen`,
    resolvedNodeEntrypointPath: null,
  };
}

describe('ensureInstalledFirstPartyComponent', () => {
  it('deduplicates concurrent acquisition and validates the installed immutable version', async () => {
    let installed = false;
    const cleanup = vi.fn(async () => undefined);
    const preparePayload = vi.fn(async () => ({
      componentId: 'mutagen-engine' as const,
      channel: 'stable' as const,
      versionId: '0.18.1',
      payloadRoot: '/prepared/mutagen-engine',
      source: 'test',
      cleanup,
    }));
    const installPayload = vi.fn(async () => {
      installed = true;
      return {
        currentVersionId: '0.18.1',
        previousVersionId: null,
        hadLegacyCurrentInstallWithoutVersionMarkers: false,
        versionPath: '/managed/mutagen-engine/versions/0.18.1',
      };
    });
    const resolveInstalled = vi.fn(() => createPaths(
      installed ? '/managed/mutagen-engine/versions/0.18.1' : '/managed/mutagen-engine/current',
    ));
    const validatePayload = vi.fn((payloadRoot: string) => {
      if (!payloadRoot.endsWith('/0.18.1')) throw new Error('missing desired version');
    });
    const params = {
      componentId: 'mutagen-engine' as const,
      channel: 'stable' as const,
      versionId: '0.18.1',
      validatePayload,
    };
    const deps = { preparePayload, installPayload, resolveInstalled };

    const [first, second] = await Promise.all([
      ensureInstalledFirstPartyComponent(params, deps),
      ensureInstalledFirstPartyComponent(params, deps),
    ]);

    expect(first.resolvedCurrentPath).toBe('/managed/mutagen-engine/versions/0.18.1');
    expect(second.resolvedCurrentPath).toBe('/managed/mutagen-engine/versions/0.18.1');
    expect(preparePayload).toHaveBeenCalledTimes(1);
    expect(installPayload).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('refuses a prepared payload whose version differs from policy', async () => {
    const cleanup = vi.fn(async () => undefined);
    const installPayload = vi.fn();

    await expect(ensureInstalledFirstPartyComponent({
      componentId: 'mutagen-engine',
      channel: 'stable',
      versionId: '0.18.1',
      validatePayload: () => {
        throw new Error('not installed');
      },
    }, {
      resolveInstalled: () => createPaths('/managed/mutagen-engine/current'),
      preparePayload: async () => ({
        componentId: 'mutagen-engine',
        channel: 'stable',
        versionId: '0.18.2',
        payloadRoot: '/prepared/mutagen-engine',
        source: 'test',
        cleanup,
      }),
      installPayload,
    })).rejects.toThrow(/does not match requested immutable version/);

    expect(installPayload).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
