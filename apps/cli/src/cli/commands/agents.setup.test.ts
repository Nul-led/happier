import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reloadConfiguration } from '@/configuration';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleLogAndMuteStdout } from '@/testkit/logger/captureOutput';

const { installAgentCliForRuntime, resolveAgentCliCommandForRuntimeMock, installedAgentIds } = vi.hoisted(() => ({
  installedAgentIds: new Set<string>(),
  installAgentCliForRuntime: vi.fn(async (params: Readonly<{ runtimeSpec: { id: string } }>) => {
    installedAgentIds.add(params.runtimeSpec.id);
    return {
      ok: true as const,
      alreadyInstalled: false,
      plan: { installMode: 'managed_package' } as any,
      logPath: null,
    };
  }),
  resolveAgentCliCommandForRuntimeMock: vi.fn((runtimeSpec: Readonly<{ id: string; binaryName: string }>) => (
    installedAgentIds.has(runtimeSpec.id)
      ? { command: runtimeSpec.binaryName, args: [], source: 'system' as const }
      : null
  )),
}));

const { resolveMergedContributionRegistryMock, getAgentCliSetupRecommendedIdsMock, interactiveTerminal, promptMultipleSelectionMock } = vi.hoisted(() => ({
  resolveMergedContributionRegistryMock: vi.fn(),
  getAgentCliSetupRecommendedIdsMock: vi.fn(() => ['claude', 'codex']),
  interactiveTerminal: { value: false },
  promptMultipleSelectionMock: vi.fn(async () => [] as string[]),
}));

vi.mock('@happier-dev/cli-common/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/cli-common/agents')>();
  return {
    ...actual,
    installAgentCliForRuntime,
    resolveAgentCliCommandForRuntime: resolveAgentCliCommandForRuntimeMock,
  };
});

vi.mock('@/terminal/prompts/promptInput', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/terminal/prompts/promptInput')>();
  return { ...actual, isInteractiveTerminal: () => interactiveTerminal.value };
});

vi.mock('@/terminal/prompts/promptMultipleChoice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/terminal/prompts/promptMultipleChoice')>();
  return { ...actual, promptMultipleSelection: promptMultipleSelectionMock };
});

vi.mock('@happier-dev/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/agents')>();
  return {
    ...actual,
    getAgentCliSetupRecommendedIds: getAgentCliSetupRecommendedIdsMock,
  };
});

vi.mock('@/plugins/projection/registry/createResolvedContributionRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/plugins/projection/registry/createResolvedContributionRegistry')>();
  return {
    ...actual,
    resolveMergedContributionRegistry: resolveMergedContributionRegistryMock,
  };
});

import { handleAgentsCommand } from './agents';

describe('happier agents setup --yes --json', () => {
  let home = '';
  let envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'PATH']);

  beforeEach(async () => {
    installAgentCliForRuntime.mockReset();
    installAgentCliForRuntime.mockImplementation(async (params: Readonly<{ runtimeSpec: { id: string } }>) => {
      installedAgentIds.add(params.runtimeSpec.id);
      return {
        ok: true as const,
        alreadyInstalled: false,
        plan: { installMode: 'managed_package' } as any,
        logPath: null,
      };
    });
    installedAgentIds.clear();
    interactiveTerminal.value = false;
    promptMultipleSelectionMock.mockReset();
    promptMultipleSelectionMock.mockResolvedValue([]);
    resolveMergedContributionRegistryMock.mockReset();
    getAgentCliSetupRecommendedIdsMock.mockClear();
    envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'PATH']);
    home = await createTempDir('happier-agents-setup-');
    envScope.patch({ HAPPIER_HOME_DIR: home, PATH: '' });
    reloadConfiguration();

    const providerContributions = [
      {
        id: 'claude',
        provenance: 'first_party' as const,
        source: { kind: 'bundled' as const },
        definition: {
          kindVersion: 1,
          id: 'claude',
          ownedBackendIds: [],
        },
        runtimeSpec: {
          kindVersion: 1,
          id: 'claude',
          title: 'Claude CLI',
          binaryName: 'claude',
          sourcePreferenceDefault: 'system-first',
          managedInstall: {
            kind: 'managed_package',
            packageName: '@happier-dev/claude',
            binaryName: 'claude',
          },
          manualInstallKind: 'command',
          manualInstallRecipes: null,
          acceptsJavaScriptFileOverride: false,
        },
      },
      {
        id: 'codex',
        provenance: 'first_party' as const,
        source: { kind: 'bundled' as const },
        definition: {
          kindVersion: 1,
          id: 'codex',
          ownedBackendIds: [],
        },
        runtimeSpec: {
          kindVersion: 1,
          id: 'codex',
          title: 'Codex CLI',
          binaryName: 'codex',
          sourcePreferenceDefault: 'system-first',
          managedInstall: {
            kind: 'managed_package',
            packageName: '@happier-dev/codex',
            binaryName: 'codex',
          },
          manualInstallKind: 'command',
          manualInstallRecipes: null,
          acceptsJavaScriptFileOverride: false,
        },
      },
    ];

    resolveMergedContributionRegistryMock.mockResolvedValue({
      agents: providerContributions,
      runtimeAdaptersByBackendId: new Map(),
      catalogEntriesById: {},
      agentDefinitionsById: new Map(providerContributions.map((provider) => [provider.id, provider] as const)),
            pluginDiagnosticsByPluginId: {},
    });
  });

  afterEach(async () => {
    envScope.restore();
    reloadConfiguration();
    if (home) await removeTempDir(home);
  });

  it('installs recommended agents without prompting', async () => {
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['setup', '--yes', '--json']);
      const parsed = JSON.parse(output.logs.join('\n').trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('agents_setup');
      expect(Array.isArray(parsed.data?.agents)).toBe(true);
      expect(parsed.data.agents.length).toBeGreaterThan(0);

      const installedIds = installAgentCliForRuntime.mock.calls.map((call) => call[0].runtimeSpec.id);
      expect(installedIds).toEqual([...getAgentCliSetupRecommendedIdsMock()]);
    } finally {
      output.restore();
    }
  });

  it('does not reinstall an already-present recommended agent under --yes', async () => {
    installedAgentIds.add('claude');
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['setup', '--yes', '--json']);
      const parsed = JSON.parse(output.logs.join('\n').trim());
      expect(parsed.ok).toBe(true);
      expect(installAgentCliForRuntime.mock.calls.map((call) => call[0].runtimeSpec.id)).toEqual(['codex']);
    } finally {
      output.restore();
    }
  });

  it('accepts --providers comma-separated selection in non-interactive mode', async () => {
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['setup', '--providers', 'claude,codex', '--json']);
      const parsed = JSON.parse(output.logs.join('\n').trim());
      expect(parsed.ok).toBe(true);

      const installedIds = installAgentCliForRuntime.mock.calls.map((call) => call[0].runtimeSpec.id);
      expect(installedIds).toEqual(['claude', 'codex']);
    } finally {
      output.restore();
    }
  });

  it('uses the interactive multi-select, excludes installed agents, and keeps recommended missing agents selected', async () => {
    installedAgentIds.add('claude');
    interactiveTerminal.value = true;
    promptMultipleSelectionMock.mockResolvedValue(['codex']);

    await handleAgentsCommand(['setup']);

    expect(promptMultipleSelectionMock).toHaveBeenCalledWith(
      expect.stringContaining('coding agents'),
      [
        expect.objectContaining({ id: 'codex', selected: true, description: expect.stringContaining('Happier-managed') }),
        expect.objectContaining({ id: 'skip', kind: 'skip' }),
      ],
    );
    expect(installAgentCliForRuntime).toHaveBeenCalledTimes(1);
    expect(installAgentCliForRuntime.mock.calls[0]?.[0].runtimeSpec.id).toBe('codex');
  });

  it('reports an install that cannot be re-detected as a failure while preserving detected successes', async () => {
    installAgentCliForRuntime.mockImplementation(async (params: Readonly<{ runtimeSpec: { id: string } }>) => {
      if (params.runtimeSpec.id === 'claude') installedAgentIds.add('claude');
      return {
        ok: true as const,
        alreadyInstalled: false,
        plan: { installMode: 'managed_package' } as any,
        logPath: null,
      };
    });
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['setup', '--providers', 'claude,codex', '--json']);
      const parsed = JSON.parse(output.logs.join('\n').trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.agents).toEqual(expect.arrayContaining([
        expect.objectContaining({ agentId: 'claude', ok: true, installed: true }),
        expect.objectContaining({ agentId: 'codex', ok: false, installed: false }),
      ]));
    } finally {
      output.restore();
    }
  });

  it('prints a typed agents_setup JSON error for unsupported agent ids', async () => {
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['setup', '--providers', 'customAcp', '--json']);
      const parsed = JSON.parse(output.logs.join('\n').trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.kind).toBe('agents_setup');
      expect(parsed.error).toEqual({
        code: 'unsupported_agent',
        message: 'Unsupported agent id(s) for setup: customAcp',
        agentIds: ['customAcp'],
      });
    } finally {
      output.restore();
    }
  });
});
