import { describe, expect, it } from 'vitest';

import type { AgentCliRuntimeDescriptor } from '@happier-dev/cli-common/agents';

import type {
  ResolvedAgentContribution,
  ResolvedContributionRegistry,
} from '@/plugins/projection/registry/types';

import { resolveReviewedRunnerAgentTarget } from './resolveReviewedAgentTarget';

describe('resolveReviewedRunnerAgentTarget', () => {
  it('resolves the exact reviewed plugin contribution identity instead of borrowing a matching local Agent id', () => {
    const runtimeSpec: AgentCliRuntimeDescriptor = Object.freeze({
      id: 'codex',
      title: 'Codex',
      binaryName: 'codex',
      knownUserBinDirSuffixes: null,
      sourcePreferenceDefault: 'system-first',
      managedInstall: null,
      manualInstallKind: 'none',
      manualInstallRecipes: null,
      acceptsJavaScriptFileOverride: false,
    });
    const codex: ResolvedAgentContribution = Object.freeze({
      id: 'codex',
      identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
      provenance: 'first_party',
      source: { kind: 'bundled' as const },
      definition: { kindVersion: 1 as const, id: 'codex', ownedBackendIds: ['codex'] },
      runtimeSpec,
      pluginId: 'happier.agent.codex',
    });
    const contributions = {
      agentDefinitionsById: new Map([[codex.id, codex]]),
    } satisfies Pick<ResolvedContributionRegistry, 'agentDefinitionsById'>;

    const selected = resolveReviewedRunnerAgentTarget({
      contributions,
      target: {
        kind: 'agent',
        identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
      },
    });
    expect(selected).toMatchObject({
      agentId: 'codex',
      backendId: 'codex',
    });
    expect(selected?.runtimeSpec.id).toBe('codex');

    expect(resolveReviewedRunnerAgentTarget({
      contributions,
      target: {
        kind: 'agent',
        identity: { pluginId: 'acme.not-codex', localId: 'codex' },
      },
    })).toBeNull();
  });

});
