import { isRecord } from '@happier-dev/plugin-sdk';

/**
 * An internal Codex thread: a rollout Codex wrote for its own machinery rather
 * than a session a person started. Approval reviewers (`guardian`) and spawned
 * sub-agents record themselves in `session_meta`; the app-server's default
 * `thread/list` already omits them (it lists interactive sources only), so the
 * rollout's own `session_meta` is the authority for every rollout-backed row.
 */
export type CodexSessionThread = Readonly<{
  kind: 'reviewer' | 'subagent';
  parentRemoteSessionId: string | null;
}>;

const MAX_PARENT_ID_CHARS = 2000;

function readParentId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_PARENT_ID_CHARS ? trimmed : null;
}

/**
 * The single Codex thread classifier, applied to a `session_meta` payload.
 * `null` means a top-level session.
 */
export function classifyCodexSessionThread(sessionMeta: unknown): CodexSessionThread | null {
  if (!isRecord(sessionMeta)) return null;
  const source = sessionMeta.source;
  const subagent = isRecord(source) && 'subagent' in source ? source.subagent : undefined;
  const threadSource = sessionMeta.thread_source;
  if (subagent === undefined && threadSource !== 'guardian_review' && threadSource !== 'subagent') {
    return null;
  }
  const spawn = isRecord(subagent) && isRecord(subagent.thread_spawn) ? subagent.thread_spawn : null;
  const reviewer = threadSource === 'guardian_review'
    || subagent === 'review'
    || (isRecord(subagent) && subagent.other === 'guardian');
  return Object.freeze({
    kind: reviewer ? 'reviewer' : 'subagent',
    parentRemoteSessionId: readParentId(sessionMeta.parent_thread_id) ?? readParentId(spawn?.parent_thread_id),
  });
}
