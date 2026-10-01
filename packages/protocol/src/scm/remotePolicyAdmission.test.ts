import { describe, expect, it } from 'vitest';
import { evaluateScmRemoteMutationPolicy } from './index.js';

describe('remote policy admission', () => {
  const policy = { requireUpstreamWhenNoExplicitTarget: false, requireActiveHead: true, blockPushOnConflicts: true, blockPushWhenBehind: false, requireCleanPull: false, blockActiveOperation: true };
  const snapshot = { hasConflicts: false, branch: { head: 'main', upstream: 'origin/main', behind: 0, detached: false }, totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0 } };
  it('blocks a resolved but unfinished sequencer before a remote mutation', () => {
    expect(evaluateScmRemoteMutationPolicy({ kind: 'pull', snapshot: { ...snapshot, operationState: { kind: 'revert', canContinue: true, canAbort: true } }, hasExplicitTarget: true, policy })).toEqual({ ok: false, reason: 'operation_in_progress' });
    expect(evaluateScmRemoteMutationPolicy({ kind: 'pull', snapshot, hasExplicitTarget: true, policy })).toEqual({ ok: true });
  });
  it('permits a detached ordinary push only with an explicitly named source', () => {
    const detached = { ...snapshot, branch: { ...snapshot.branch, head: null, detached: true } };
    expect(evaluateScmRemoteMutationPolicy({ kind: 'push', snapshot: detached, hasExplicitTarget: true, policy: { ...policy, allowDetachedPushWithExplicitSource: true } })).toEqual({ ok: true });
    expect(evaluateScmRemoteMutationPolicy({ kind: 'push', snapshot: detached, hasExplicitTarget: false, policy: { ...policy, allowDetachedPushWithExplicitSource: true } })).toEqual({ ok: false, reason: 'detached_head' });
  });
});
