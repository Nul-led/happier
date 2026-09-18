import {
  CODEX_ACP_DEP_ID,
  GH_INSTALLABLE_DESCRIPTOR,
  INSTALLABLE_KEYS,
  InstallableDependencyDescriptorSchema,
  resolveInstallablesRegistry,
  type InstallableDependencyDescriptor,
} from '@happier-dev/protocol/installables';
import { describe, expect, it, vi } from 'vitest';

import { createCapabilitiesService } from '@/capabilities/service';
import { checklists } from '../checklists';
import type {
  RuntimeInstallableAdapter,
  RuntimeInstallableCapabilityStatusParams,
  RuntimeInstallableInstallResult,
  RuntimeInstallableLaunchResolution,
} from '@/packagedRuntime/installables/registry';

import {
  createInstallableCapabilities,
  createInstallableCapabilitiesFromContributions,
  createInstallableCapabilityRequests,
  type RuntimeInstallableAdapterResolver,
} from './installables';
import type { ResolvedInstallableContribution } from '@/plugins/projection/registry/types';

const codexAcpInstallableDescriptor = InstallableDependencyDescriptorSchema.parse({
  id: INSTALLABLE_KEYS.CODEX_ACP,
  key: INSTALLABLE_KEYS.CODEX_ACP,
  kind: 'dep',
  version: '1',
  capabilityId: CODEX_ACP_DEP_ID,
  display: {
    name: 'Codex ACP',
  },
  description: 'Codex ACP dependency test fixture',
  source: {
    kind: 'github_release_binary',
    repo: 'zed-industries/codex-acp',
    distTag: 'latest',
  },
  binary: {
    commands: ['codex-acp'],
    systemFirst: true,
    managedFallback: true,
  },
  defaultPolicy: {
    autoInstallWhenNeeded: true,
    autoUpdateMode: 'auto',
  },
  consent: {
    install: 'not_required',
    update: 'not_required',
  },
  stability: {
    experimental: true,
    supported: true,
  },
});

function createRegistry(descriptors: readonly InstallableDependencyDescriptor[]) {
  return resolveInstallablesRegistry({
    builtIns: descriptors.map((descriptor) => ({
      owner: {
        provenance: 'built_in' as const,
        ownerId: 'test',
      },
      descriptor,
    })),
  });
}

const unavailableLaunchResolution: RuntimeInstallableLaunchResolution = {
  availability: { ok: false, errorMessage: 'not installed' },
  canAutoInstall: true,
  canBackgroundAutoUpdate: false,
};

function createAdapter(params: Readonly<{
  descriptor?: InstallableDependencyDescriptor;
  detectCapabilityStatus?: RuntimeInstallableAdapter['detectCapabilityStatus'];
  installOrUpgrade?: RuntimeInstallableAdapter['installOrUpgrade'];
}> = {}): RuntimeInstallableAdapter {
  const descriptor = params.descriptor ?? codexAcpInstallableDescriptor;
  return {
    key: descriptor.key,
    capabilityId: descriptor.capabilityId,
    ...(params.detectCapabilityStatus ? { detectCapabilityStatus: params.detectCapabilityStatus } : {}),
    detectLaunchResolution: async () => unavailableLaunchResolution,
    installOrUpgrade: params.installOrUpgrade ?? (async () => ({ ok: true, logPath: '/tmp/install.log' })),
    runBackgroundAutoUpdateCheck: async () => undefined,
  };
}

describe('installable capability projection', () => {
  it('projects descriptor metadata and routes detect/install/upgrade through the runtime adapter', async () => {
    const registry = createRegistry([codexAcpInstallableDescriptor]);
    const detectedStatus = Object.freeze({ installed: true, sourceKind: 'github_release_binary' });
    const detectCapabilityStatus = vi.fn(
      async (_params?: RuntimeInstallableCapabilityStatusParams) => detectedStatus,
    );
    const installOrUpgrade = vi.fn<() => Promise<RuntimeInstallableInstallResult>>(
      async () => ({ ok: true, logPath: '/tmp/codex-acp.log' }),
    );
    const resolveAdapter: RuntimeInstallableAdapterResolver = async (key, opts) => {
      expect(key).toBe(codexAcpInstallableDescriptor.key);
      expect(opts?.installablesRegistry).toBe(registry);
      return createAdapter({
        detectCapabilityStatus,
        installOrUpgrade,
      });
    };

    const capabilities = await createInstallableCapabilities({
      installablesRegistry: registry,
      getRuntimeInstallableAdapter: resolveAdapter,
    });

    expect(capabilities).toHaveLength(1);
    const capability = capabilities[0]!;
    expect(capability.descriptor).toMatchObject({
      id: 'dep.codex-acp',
      kind: 'dep',
      title: 'Codex ACP',
      methods: {
        install: { title: 'Install' },
        upgrade: { title: 'Upgrade' },
      },
    });

    await expect(capability.detect({
      request: {
        id: 'dep.codex-acp',
        params: {
          includeLatestVersion: true,
          onlyIfInstalled: true,
        },
      },
      context: { cliSnapshot: null },
    })).resolves.toBe(detectedStatus);
    expect(detectCapabilityStatus).toHaveBeenCalledWith({
      includeLatestVersion: true,
      onlyIfInstalled: true,
    });

    await expect(capability.invoke?.({ method: 'install' })).resolves.toEqual({
      ok: true,
      result: { logPath: '/tmp/codex-acp.log' },
    });
    await expect(capability.invoke?.({ method: 'upgrade' })).resolves.toEqual({
      ok: true,
      result: { logPath: '/tmp/codex-acp.log' },
    });
    expect(installOrUpgrade).toHaveBeenCalledTimes(2);
  });

  it('returns the existing unsupported-method public error shape for unknown installable methods', async () => {
    const registry = createRegistry([codexAcpInstallableDescriptor]);
    const capabilities = await createInstallableCapabilities({
      installablesRegistry: registry,
      getRuntimeInstallableAdapter: async () => createAdapter(),
    });
    const service = createCapabilitiesService({
      capabilities,
      checklists,
      buildContext: async () => ({ cliSnapshot: null }),
    });

    await expect(service.invoke({
      id: 'dep.codex-acp',
      method: 'remove',
    })).resolves.toEqual({
      ok: false,
      error: {
        message: 'Unsupported method: remove',
        code: 'unsupported-method',
      },
    });
  });

  it('does not duplicate capabilities already owned by explicit registries', async () => {
    const registry = createRegistry([GH_INSTALLABLE_DESCRIPTOR]);
    const resolveAdapter = vi.fn<RuntimeInstallableAdapterResolver>(
      async () => createAdapter({ descriptor: GH_INSTALLABLE_DESCRIPTOR }),
    );

    const capabilities = await createInstallableCapabilities({
      installablesRegistry: registry,
      existingCapabilityIds: new Set(['dep.gh']),
      getRuntimeInstallableAdapter: resolveAdapter,
    });

    expect(capabilities).toEqual([]);
    expect(resolveAdapter).not.toHaveBeenCalled();
  });

  it('fails closed when the runtime adapter does not match the descriptor capability id', async () => {
    const registry = createRegistry([codexAcpInstallableDescriptor]);
    const mismatchedAdapter: RuntimeInstallableAdapter = {
      ...createAdapter(),
      capabilityId: 'dep.other-tool',
    };

    await expect(createInstallableCapabilities({
      installablesRegistry: registry,
      getRuntimeInstallableAdapter: async () => mismatchedAdapter,
    })).resolves.toEqual([]);
  });

  it('builds detect requests from installable descriptors', () => {
    const registry = createRegistry([codexAcpInstallableDescriptor, GH_INSTALLABLE_DESCRIPTOR]);

    expect(createInstallableCapabilityRequests(registry)).toEqual([
      { id: 'dep.codex-acp' },
      { id: 'dep.gh' },
    ]);
  });

  it('exposes an installed external V2 managed PyPI source through the user-consented install capability', async () => {
    const installOrUpgrade = vi.fn(async () => ({ ok: true as const, logPath: '/tmp/localharness.log' }));
    const contribution = {
      provenance: 'external',
      source: { kind: 'package' },
      pluginId: 'com.acme.antigravity',
      manifestPath: '/immutable/generations/com.acme.antigravity/.happier-plugin/plugin.json',
      daemonEntryPath: '/immutable/generations/com.acme.antigravity/daemon.mjs',
      sourceSpec: {
        kind: 'package',
        locator: '@acme/antigravity',
        trustPolicy: 'prompt',
        installPolicy: 'managed_install',
        resolvedVersion: '1.0.0',
      },
      definition: {
        id: 'localharness',
        title: 'Antigravity localharness',
        executable: 'localharness',
        sources: [{
          kind: 'managedPypiWheelAsset',
          installId: 'dep.antigravity.localharness',
          distribution: 'google-antigravity',
          versionSpecifier: '>=0.1.4,<0.2.0',
          assetPathByPlatform: {
            'darwin-arm64': 'google/antigravity/bin/localharness',
            'linux-x64': 'google/antigravity/bin/localharness',
            'linux-arm64': 'google/antigravity/bin/localharness',
            'win32-x64': 'google/antigravity/bin/localharness.exe',
            'win32-arm64': 'google/antigravity/bin/localharness.exe',
          },
          executable: true,
          installConsent: 'host_managed_required',
          autoUpdateMode: 'notify',
        }],
      },
    } satisfies ResolvedInstallableContribution;

    const capabilities = await createInstallableCapabilitiesFromContributions({
      installables: [contribution],
      getRuntimeInstallableAdapter: async (key, options) => {
        const descriptor = options?.installablesRegistry?.descriptorsByKey[key]?.descriptor;
        expect(descriptor).toMatchObject({
          key: 'dep.antigravity.localharness',
          consent: {
            install: 'required',
            update: 'required',
          },
        });
        return createAdapter({
          descriptor,
          installOrUpgrade,
        });
      },
    });

    expect(capabilities.map((capability) => capability.descriptor.id)).toEqual([
      'dep.antigravity.localharness',
    ]);
    await expect(capabilities[0]?.invoke?.({ method: 'install' })).resolves.toEqual({
      ok: true,
      result: { logPath: '/tmp/localharness.log' },
    });
    expect(installOrUpgrade).toHaveBeenCalledTimes(1);
  });
  it('exposes a V2 pinned-archive source through the real runtime installable adapter so UI status and install reach the pinned installer', async () => {
    const asset = (suffix: string) => ({
      archiveUrl: `https://downloads.acme.test/acme-pinned-tool-4.5.6-${suffix}.zip`,
      sha256: 'b'.repeat(64),
      executableSubpath: suffix.startsWith('win32') ? 'bin/acme-pinned-tool.exe' : 'bin/acme-pinned-tool',
    });
    const contribution = {
      provenance: 'external',
      source: { kind: 'package' },
      pluginId: 'com.acme.pinned',
      manifestPath: '/immutable/generations/com.acme.pinned/.happier-plugin/plugin.json',
      daemonEntryPath: '/immutable/generations/com.acme.pinned/daemon.mjs',
      sourceSpec: {
        kind: 'package',
        locator: '@acme/pinned',
        trustPolicy: 'prompt',
        installPolicy: 'managed_install',
        resolvedVersion: '1.0.0',
      },
      definition: {
        id: 'pinned-tool',
        title: 'Acme pinned tool',
        executable: 'acme-pinned-tool',
        sources: [{
          kind: 'pinnedArchive',
          installId: 'dep.acme.pinned-tool',
          version: '4.5.6',
          assetsByPlatform: {
            'darwin-arm64': asset('darwin-arm64'),
            'linux-x64': asset('linux-x64'),
            'linux-arm64': asset('linux-arm64'),
            'win32-x64': asset('win32-x64'),
            'win32-arm64': asset('win32-arm64'),
          },
        }],
      },
    } satisfies ResolvedInstallableContribution;

    // No adapter stub: the default runtime resolver must own this source kind end to end.
    const capabilities = await createInstallableCapabilitiesFromContributions({
      installables: [contribution],
    });

    expect(capabilities.map((capability) => capability.descriptor.id)).toEqual([
      'dep.acme.pinned-tool',
    ]);
    expect(capabilities[0]?.descriptor).toMatchObject({
      kind: 'dep',
      title: 'Acme pinned tool',
      methods: { install: { title: 'Install' }, upgrade: { title: 'Upgrade' } },
    });
    // The capability answers with a readable status the UI installables planner can act on
    // instead of the null status that suppresses every background prewarm.
    await expect(capabilities[0]?.detect({
      request: { id: 'dep.acme.pinned-tool' },
      context: { cliSnapshot: null },
    })).resolves.toMatchObject({
      installed: false,
      installedVersion: null,
      sourceKind: 'pinned_archive',
    });
  });
});
