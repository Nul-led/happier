import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScmCapabilities, ScmPullRequestPrepareWorktreeRequestSchema } from '@happier-dev/protocol/scm';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));

import { storage } from '@/sync/domains/state/storage';
import { createUiScmAction } from './scmActionDeps';
import { sessionScmCommitUndoLast } from '@/sync/ops/sessionScm';

const executeCanonicalAction = async () => ({ ok: false as const, errorCode: 'unsupported_action', error: 'unsupported_action' });
const expectedHeadOid = 'a'.repeat(40);

beforeEach(() => {
    storage.setState(storage.getInitialState(), true);
    rpc.mockReset();
    rpc.mockImplementation(async ({ method }: { method: string }) => method === 'scm.backend.describe'
        ? { success: true, capabilities: createScmCapabilities({ writeCommitUndoLast: true }) }
        : method === 'scm.pullRequest.prepareWorktree' ? { success: true, targetPath: '/repo/review' }
        : { success: true, undoneCommitSha: expectedHeadOid });
});

describe('SCM Action target binding', () => {
    it('refuses machine undo without an explicit repository instead of using daemon cwd', async () => {
        expect(await createUiScmAction()({ actionId: 'scm.commit.undoLast', input: { expectedHeadOid },
            context: { serverId: 'home-other', runtimeAccountId: 'account-other', externalActionTarget: { kind: 'machine', machineId: 'machine-other' } }, executeCanonicalAction,
        })).toMatchObject({ ok: false, errorCode: 'invalid_input' });
        expect(rpc).not.toHaveBeenCalled();
    });

    it('binds session undo and prepared-worktree source to the selected session repository', async () => {
        storage.setState({ sessions: { selected: createSessionFixture({ id: 'selected', serverId: 'home-other',
            metadata: { path: '/repo/selected', machineId: 'machine-other', host: 'host', homeDir: '/home/user' },
        }) } });
        const context = { serverId: 'home-other', runtimeAccountId: 'account-other', defaultSessionId: 'selected' };
        await createUiScmAction()({ actionId: 'scm.commit.undoLast', input: { cwd: '/repo/not-selected', expectedHeadOid }, context, executeCanonicalAction });
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'home-other', accountId: 'account-other', machineId: 'machine-other',
            method: 'scm.commit.undoLast', payload: { cwd: '/repo/selected', expectedHeadOid, outcomeVersion: 1 },
        }));
        const preparedInput = ScmPullRequestPrepareWorktreeRequestSchema.parse({ cwd: '/repo/not-selected', sourcePath: '/repo/not-selected', prReference: { number: 7 } });
        await createUiScmAction()({ actionId: 'scm.pullRequest.prepareWorktree', input: preparedInput, context, executeCanonicalAction });
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ method: 'scm.pullRequest.prepareWorktree', payload: {
            ...preparedInput, cwd: '/repo/selected', sourcePath: '/repo/selected', outcomeVersion: 1,
        } }));
        // Action binding must not change the ordinary facade's relative-path contract.
        expect(await sessionScmCommitUndoLast('selected', { cwd: 'nested', expectedHeadOid }, 'home-other'))
            .toMatchObject({ success: true, undoneCommitSha: expectedHeadOid });
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'home-other', machineId: 'machine-other',
            method: 'scm.commit.undoLast', payload: { cwd: '/repo/selected/nested', expectedHeadOid, outcomeVersion: 1 },
        }));
    });
});
