/**
 * Credentialless in-session MCP memory tools may inspect only their host-bound
 * Session. Authentication-backed MCP keeps using the canonical Account reader.
 */
export function isSessionBoundMemoryTarget(input: Readonly<{
  boundSessionId: string;
  requestedSessionId: string;
}>): boolean {
  const boundSessionId = String(input.boundSessionId ?? '').trim();
  const requestedSessionId = String(input.requestedSessionId ?? '').trim();
  return boundSessionId.length > 0 && requestedSessionId === boundSessionId;
}
