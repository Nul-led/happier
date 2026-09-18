import type { AgentTerminalSurface } from '@happier-dev/plugin-sdk/agents/runtime';
import { readAntigravityTerminalConversationId } from './runtimeDescriptor.js';

export type AntigravityTerminalLaunchArgsInput = Readonly<{
  conversationId?: string | null;
  modelId?: string | null;
}>;

function readModelIdCandidate(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized === 'default') return null;
  return normalized;
}

export function resolveAntigravityTerminalLaunchArgsInput(
  metadata: Readonly<Record<string, unknown>>,
  modelSelection: Parameters<AgentTerminalSurface['resolveLaunch']>[0]['modelSelection'],
): AntigravityTerminalLaunchArgsInput {
  return {
    conversationId: readAntigravityTerminalConversationId(metadata.runtimeDescriptorV1),
    modelId: readModelIdCandidate(modelSelection?.modelId),
  };
}

function readNonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readSelectedModelId(value: string | null | undefined): string | null {
  const normalized = readNonEmpty(value);
  return normalized && normalized !== 'default' ? normalized : null;
}

export function buildAntigravityTerminalLaunchArgs(input: AntigravityTerminalLaunchArgsInput = {}): string[] {
  const args: string[] = [];
  const conversationId = readNonEmpty(input.conversationId);
  if (conversationId) {
    args.push('--conversation', conversationId);
  }

  const modelId = readSelectedModelId(input.modelId);
  if (modelId) {
    args.push('--model', modelId);
  }

  return args;
}
