import type { ActionId } from '../actionIds.js';
import type { ActionContextualDefaults } from '../contextualDefaults.js';
import type { ActionExecuteFailure, ActionExecutorContext } from './types.js';

export function isAutonomousSessionListSurface(surface: unknown): boolean {
  return surface === 'agent' || surface === 'mcp' || surface === 'plugin';
}

/** Shared admission for hosts that cannot supply an authorized Session-list corpus. */
export function resolveActionSessionListAccessFailure(
  actionId: ActionId,
  context: ActionExecutorContext | undefined,
): ActionExecuteFailure | null {
  if (actionId !== 'session.list') return null;
  if (!isAutonomousSessionListSurface(context?.surface)) return null;

  const defaultSessionId = context?.defaultSessionId?.trim() ?? '';
  return context?.sessionListAccess === 'current_session' && defaultSessionId.length > 0
    ? null
    : { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:session.list' };
}

/**
 * Enforces the host's admitted current-Session corpus for Action declarations
 * whose `sessionId` is contextually bound to that Session. Contextual defaults
 * remain a convenience for unconstrained human/API callers. The Agent surface
 * is intrinsically bound to its current Session; other autonomous surfaces use
 * the host-only `sessionListAccess` fact to declare the same restricted corpus.
 */
export function resolveActionCurrentSessionScopeFailure(
  actionId: ActionId,
  input: unknown,
  context: ActionExecutorContext | undefined,
  contextualDefaults: ActionContextualDefaults | undefined,
): ActionExecuteFailure | null {
  if (contextualDefaults?.sessionId !== 'current_session') return null;
  // Agent-originated cross-Session message delivery is authorized by the
  // Message Action owner, which requires a host-stamped active-turn source and
  // causal permission authority. Do not preempt that stronger domain check
  // with the generic contextual-default guard. External MCP/plugin surfaces
  // remain bound when their host declares current-Session-only list access.
  if (actionId === 'session.message.send' && context?.surface === 'agent') return null;
  if (!isAutonomousSessionListSurface(context?.surface)) return null;
  if (context?.surface !== 'agent' && context?.sessionListAccess !== 'current_session') return null;

  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const inputRecord = input as Readonly<Record<string, unknown>>;
  if (!Object.prototype.hasOwnProperty.call(inputRecord, 'sessionId')) return null;
  if (typeof inputRecord.sessionId !== 'string') return null;

  const defaultSessionId = context.defaultSessionId?.trim() ?? '';
  if (!defaultSessionId) {
    return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
  }

  return inputRecord.sessionId.trim() === defaultSessionId
    ? null
    : { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
}
