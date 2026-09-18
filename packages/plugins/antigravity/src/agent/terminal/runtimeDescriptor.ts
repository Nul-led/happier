/**
 * Antigravity sessions run on the host-owned ACP runtime, while the interactive `agy`
 * CLI stays a separate surface. The only identity the terminal leaf may reuse is an
 * Antigravity CLI conversation id the host recorded for this session; an ACP session id
 * is deliberately never projected onto `agy --conversation`.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readAgentExtraRuntimeHandle(value: unknown): Record<string, unknown> | null {
  const extra = asRecord(value);
  if (
    !extra
    || extra.owner !== 'antigravity'
    || extra.schemaId !== 'antigravity.agentRuntimeDescriptorExtra'
    || extra.v !== 1
  ) {
    return null;
  }
  return asRecord(extra.runtimeHandle);
}

export function readAntigravityTerminalConversationId(value: unknown): string | null {
  const descriptor = asRecord(value);
  if (
    !descriptor
    || descriptor.v !== 1
    || descriptor.agentId !== 'antigravity'
    || Object.hasOwn(descriptor, 'providerId')
    || Object.hasOwn(descriptor, 'provider')
  ) {
    return null;
  }

  const agent = asRecord(descriptor.agent);
  if (!agent) return null;
  const handle = readAgentExtraRuntimeHandle(agent.agentExtra);
  return normalizeTrimmedString(handle?.agyConversationId)
    ?? normalizeTrimmedString(agent.agyConversationId);
}
