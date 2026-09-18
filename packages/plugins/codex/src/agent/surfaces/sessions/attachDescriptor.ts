import type {
  AgentProviderCliAttachTargetResolutionV1,
  AgentProviderCliAttachTargetV1,
  AttachSessionMetadata,
} from '@happier-dev/plugin-sdk/agents/runtime';

import { readCanonicalCodexAgentRuntimeDescriptorV1 } from '../../../protocol/runtimeDescriptorV1.js';

export function resolveCodexAttachTarget(params: Readonly<{
  metadata: AttachSessionMetadata;
}>): AgentProviderCliAttachTargetResolutionV1 {
  const descriptor = readCanonicalCodexAgentRuntimeDescriptorV1(params.metadata.runtimeDescriptorV1);
  const directory = typeof params.metadata.path === 'string' && params.metadata.path.trim()
    ? params.metadata.path.trim()
    : null;
  if (descriptor?.backendMode !== 'appServer') {
    return { ok: false, reason: 'Codex attach is only available for app-server sessions.' };
  }
  if (!descriptor.providerSessionId) {
    return { ok: false, reason: 'Session does not include a Codex provider session id.' };
  }
  if (!directory) {
    return { ok: false, reason: 'Session metadata is missing a working directory path.' };
  }
  const endpoint = descriptor.appServerEndpoint;
  if (!endpoint?.startsWith('unix://') || endpoint.length <= 'unix://'.length) {
    return { ok: false, reason: 'Session does not include a shared Codex app-server endpoint.' };
  }
  return {
    ok: true,
    value: {
      providerSessionId: descriptor.providerSessionId,
      directory,
      endpoint,
      socketPath: endpoint.slice('unix://'.length),
    },
  };
}

export function createCodexAttachArgs(target: AgentProviderCliAttachTargetV1): string[] {
  return [
    '--remote', target.endpoint,
    '--cd', target.directory,
    'resume', target.providerSessionId,
  ];
}

export function resolveCodexAttachReachability(target: AgentProviderCliAttachTargetV1) {
  return { kind: 'localSocket' as const, path: target.socketPath };
}
