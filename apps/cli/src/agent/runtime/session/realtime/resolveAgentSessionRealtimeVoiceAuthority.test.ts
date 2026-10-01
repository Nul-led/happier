import type {
  PluginContributionIdentityV1,
  VoiceProviderContribution,
} from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  createAgentSessionRunnerFactoryBinding,
} from '@/plugins/runtime/runner/agentSessionRunnerFactoryBinding';

import {
  resolveAgentSessionRealtimeVoiceAuthority,
  resolveRetainedAgentSessionRealtimeVoiceAuthority,
} from './resolveAgentSessionRealtimeVoiceAuthority';

const selectedAgent = {
  pluginId: 'happier.agent.codex',
  localId: 'codex',
} as const;
const installedProvider = {
  pluginId: 'example.voice.never-seen',
  localId: 'conversation',
} as const;
const wrongAgentProvider = {
  pluginId: installedProvider.pluginId,
  localId: 'wrong-agent',
} as const;
function conversation(
  id: string,
  agent: PluginContributionIdentityV1,
  bindingAgent: PluginContributionIdentityV1 | null = agent,
): Extract<
  VoiceProviderContribution,
  Readonly<{ kind: 'conversation' }>
> {
  return {
    id,
    title: id,
    kind: 'conversation',
    roles: ['realtime_conversation'],
    platforms: ['web'],
    capabilities: {
      turn: { cancelResponse: false, bargeIn: false },
      tools: { effectCalls: 'none' },
    },
    execution: {
      kind: 'experimental_agent_session_realtime',
      agent,
      supportedRuntimeVersions: ['1.2.3'],
    },
    ...(bindingAgent
      ? {
          settings: {
            schemaVersion: 2,
            fields: [],
            connectedServicesBinding: {
              id: 'globalConnectedServices',
              title: 'Agent account',
              agent: bindingAgent,
              serviceIds: ['openai-codex'],
            },
          },
        }
      : {}),
    client: {
      artifactId: 'installed-voice-runtime',
      exportName: 'activate',
    },
  };
}

describe('resolveAgentSessionRealtimeVoiceAuthority', () => {
  it('materializes exact installed declarations from the current registry generation', () => {
    let current = true;
    const retirement = new AbortController();
    const resolveVoiceProviderRuntimeLifecycle = vi.fn((identity: PluginContributionIdentityV1) => (
      identity.pluginId === installedProvider.pluginId && identity.localId === installedProvider.localId
        ? {
            occurrenceId: 'installed-provider-occurrence',
            isCurrent: () => current,
            retirementSignal: retirement.signal,
          }
        : null
    ));
    const authority = resolveAgentSessionRealtimeVoiceAuthority({
      runtimeRegistry: {
        contributes: {
          voiceProviders: [
            {
              pluginId: installedProvider.pluginId,
              identity: installedProvider,
              definition: conversation(
                installedProvider.localId,
                selectedAgent,
              ),
            },
            {
              pluginId: wrongAgentProvider.pluginId,
              identity: wrongAgentProvider,
              definition: conversation(
                wrongAgentProvider.localId,
                {
                  pluginId: 'happier.agent.other',
                  localId: 'other',
                },
              ),
            },
          ],
        },
        resolveVoiceProviderRuntimeLifecycle,
      },
      policyAgentRef: selectedAgent,
      agentRuntimeIdentity: {
        pluginId: selectedAgent.pluginId,
        agentId: selectedAgent.localId,
        occurrenceId: 'agent-occurrence',
        sourceCustody: {
          kind: 'managed',
          immutableGenerationId: 'installed-agent-generation',
          installSource: 'npm',
        },
        isCurrent: () => current,
      },
      agentRetirementSignal: retirement.signal,
    });

    expect(authority).not.toBeNull();
    expect(authority?.occurrenceId).toBe('agent-occurrence');
    expect(authority?.resolveDeclaration(installedProvider)?.id).toBe(
      installedProvider.localId,
    );
    expect(authority?.resolveProviderOccurrenceId(installedProvider)).toBe(
      'installed-provider-generation',
    );
    expect(authority?.isCurrent(installedProvider)).toBe(true);
    expect(authority?.resolveDeclaration(wrongAgentProvider)).toBeNull();
    expect(authority?.isCurrent(wrongAgentProvider)).toBe(false);
    expect(resolveVoiceProviderRuntimeLifecycle).toHaveBeenCalledWith(installedProvider);

    current = false;
    retirement.abort();
    expect(authority?.isCurrent(installedProvider)).toBe(false);
    expect(
      authority?.resolveRetirementSignal(installedProvider)?.aborted,
    ).toBe(true);
  });

  it('fails closed when the selected runtime identity is not the policy Agent', () => {
    expect(resolveAgentSessionRealtimeVoiceAuthority({
      runtimeRegistry: {
        contributes: { voiceProviders: [] },
        resolveVoiceProviderRuntimeLifecycle: () => null,
      },
      policyAgentRef: selectedAgent,
      agentRuntimeIdentity: {
        pluginId: selectedAgent.pluginId,
        agentId: 'other',
        occurrenceId: 'agent-occurrence',
        sourceCustody: {
          kind: 'development',
          registeredRootId: 'development-root-1',
        },
        isCurrent: () => true,
      },
    })).toBeNull();
  });

  it('keeps an Agent-session realtime declaration eligible without a Connected Services binding', () => {
    const providerRetirement = new AbortController();
    const authority = resolveAgentSessionRealtimeVoiceAuthority({
      runtimeRegistry: {
        contributes: {
          voiceProviders: [{
            pluginId: installedProvider.pluginId,
            identity: installedProvider,
            definition: conversation(
              installedProvider.localId,
              selectedAgent,
              null,
            ),
          }],
        },
        resolveVoiceProviderRuntimeLifecycle: () => ({
          occurrenceId: 'installed-provider-occurrence',
          isCurrent: () => !providerRetirement.signal.aborted,
          retirementSignal: providerRetirement.signal,
        }),
      },
      policyAgentRef: selectedAgent,
      agentRuntimeIdentity: {
        pluginId: selectedAgent.pluginId,
        agentId: selectedAgent.localId,
        occurrenceId: 'agent-occurrence',
        sourceCustody: {
          kind: 'development',
          registeredRootId: 'development-root-1',
        },
        isCurrent: () => true,
      },
    });

    expect(authority?.resolveDeclaration(installedProvider)?.id).toBe(
      installedProvider.localId,
    );
    expect(authority?.isCurrent(installedProvider)).toBe(true);
  });

  it('fails closed for a malformed runner-carried retained Agent binding', () => {
    const registryWithCurrentG = {
      contributes: {
        voiceProviders: [{
          pluginId: installedProvider.pluginId,
          identity: installedProvider,
          definition: conversation(installedProvider.localId, selectedAgent),
        }],
      },
      agentRuntimesByAgentId: new Map([['codex-session', {
        pluginId: selectedAgent.pluginId,
        agentId: 'codex-session',
        occurrenceId: 'agent-occurrence-G',
        immutableGenerationId: 'installed-agent-generation-G',
        sessionRunnerFactoryBinding: {
          pluginId: selectedAgent.pluginId,
          agentId: 'codex-session',
          localAgentId: selectedAgent.localId,
          immutableGenerationId: 'installed-agent-generation-G',
        },
        isCurrent: () => true,
        retirementSignal: new AbortController().signal,
      }]]),
      resolveVoiceProviderRuntimeLifecycle: () => ({
        occurrenceId: 'installed-provider-occurrence',
        isCurrent: () => true,
        retirementSignal: new AbortController().signal,
      }),
    };
    expect(resolveRetainedAgentSessionRealtimeVoiceAuthority({
      runtimeRegistry: registryWithCurrentG,
      retainedAgent: {
        pluginId: selectedAgent.pluginId,
        agentId: 'codex-session',
        localAgentId: selectedAgent.localId,
        immutableGenerationId: 'installed-agent-generation-G',
      },
    })).toBeNull();
  });

  it('keeps retained G Voice authority current when H replaces its registry Agent, then retires with the current Voice provider', () => {
    const providerRetirement = new AbortController();
    const retainedAgent = createAgentSessionRunnerFactoryBinding({
      v: 1,
      pluginId: selectedAgent.pluginId,
      pluginVersion: '1.2.3',
      agentId: 'codex-session',
      localAgentId: selectedAgent.localId,
      sourceCustody: {
        kind: 'managed',
        immutableGenerationId: 'installed-agent-generation-G',
        installSource: 'npm',
      },
      locator: {
        module: './agent/runtime.js',
        export: 'createAgentRuntime',
        runtimeApiVersion: 1,
      },
      normalizedModulePath: 'agent/runtime.js',
      loadMode: 'immutable-js',
    });
    const registryAfterH = {
      contributes: {
        voiceProviders: [{
          pluginId: installedProvider.pluginId,
          identity: installedProvider,
          definition: conversation(installedProvider.localId, selectedAgent),
        }],
      },
      agentRuntimesByAgentId: new Map([['codex-session', {
        pluginId: selectedAgent.pluginId,
        agentId: 'codex-session',
        occurrenceId: 'agent-occurrence-H',
        immutableGenerationId: 'installed-agent-generation-H',
        sessionRunnerFactoryBinding: {
          pluginId: selectedAgent.pluginId,
          agentId: 'codex-session',
          localAgentId: selectedAgent.localId,
          immutableGenerationId: 'installed-agent-generation-H',
        },
        isCurrent: () => true,
        retirementSignal: new AbortController().signal,
      }]]),
      resolveVoiceProviderRuntimeLifecycle: () => ({
        occurrenceId: 'installed-provider-occurrence',
        isCurrent: () => !providerRetirement.signal.aborted,
        retirementSignal: providerRetirement.signal,
      }),
    };
    const authority = resolveRetainedAgentSessionRealtimeVoiceAuthority({
      runtimeRegistry: registryAfterH,
      retainedAgent,
    });

    const retirementSignal = authority?.resolveRetirementSignal(installedProvider);
    expect(authority?.occurrenceId).toBe(
      JSON.stringify(retainedAgent.sourceCustody),
    );
    expect(authority?.isCurrent(installedProvider)).toBe(true);
    expect(retirementSignal?.aborted).toBe(false);

    providerRetirement.abort(new Error('current Voice provider retired'));

    expect(retirementSignal?.aborted).toBe(true);
    expect(authority?.isCurrent(installedProvider)).toBe(false);
  });
});
