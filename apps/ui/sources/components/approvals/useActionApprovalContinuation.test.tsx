import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalRequestV2Schema, buildApprovalRequestArtifactHeaderV1 } from '@happier-dev/protocol';

// Imported from their owning testkit modules, never the `@/dev/testkit` barrel:
// the harness installs its network boundaries with `vi.doMock`, which only
// reaches modules imported afterwards (see `installHomeGovernanceBoundaries`).
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { teamCapabilitiesFixture, teamSummaryFixture } from '@/dev/testkit/fixtures/teamFixtures';
import { createUiApprovalRequest, decideApprovalAsInbox } from '@/dev/testkit/harness/approvalInbox';
import {
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
    waitForHomeGovernance,
} from '@/dev/testkit/harness/homeGovernanceHarness';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import type { ActionApprovalContinuation } from './actionApprovalContinuation';

/**
 * The shared result-custody owner, over the real approval lifecycle.
 *
 * Every approval here is one the product writes: a present-user Team rename
 * creates it through the shared Action front door, the Inbox decides it through
 * the generic executor, and the hook observes the outcome through the real
 * `useApprovalArtifact` reading the Home's stateful Artifact store. Only the
 * network and the device credential store are replaced; no terminal record is
 * assembled by the test.
 */

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const ACCOUNT_ID = 'account-a';
const TEAM_UPDATE_PATH = '/v1/teams/update';

/** One Home whose Account explicitly requires approval for a Team rename. */
async function addApprovalHome(): Promise<string> {
    const serverId = await harness.addHome({
        name: 'Home One',
        serverUrl: 'https://approval-continuation.example',
        accountId: ACCOUNT_ID,
        teamsEnabled: true,
    });
    await harness.requireUiApproval(serverId, 'teams.update');
    return serverId;
}

async function openRenameApproval(serverId: string, requestId: string, name = 'Renamed'): Promise<string> {
    return await createUiApprovalRequest({
        serverId,
        actionId: 'teams.update',
        actionInput: { v: 1, teamId: 'team-1', name },
        actionRequestId: requestId,
    });
}

function answerRename(serverId: string): void {
    harness.answer(serverId, TEAM_UPDATE_PATH, {
        body: teamSummaryFixture({ name: 'Renamed', capabilities: teamCapabilitiesFixture({ manageSettings: true }) }),
    });
}

async function renderContinuation(serverId: string, onExecuted: () => void = vi.fn()) {
    const { useActionApprovalContinuation } = await import('./useActionApprovalContinuation');
    return await renderHook(({ scopeKey }: { scopeKey: string }) => useActionApprovalContinuation({
        scopeKey,
        serverId,
        onExecuted,
    }), { initialProps: { scopeKey: `${serverId}:${ACCOUNT_ID}` } });
}

describe('useActionApprovalContinuation', () => {
    beforeEach(async () => {
        standardCleanup();
        await harness.reset();
    });

    afterEach(() => standardCleanup());

    it('claims and clears an executed result before delivering it exactly once', async () => {
        const serverId = await addApprovalHome();
        answerRename(serverId);
        const artifactId = await openRenameApproval(serverId, 'rename-executed');
        const refresh = vi.fn();
        const hook = await renderContinuation(serverId, refresh);
        const deliveryObservedCustody = vi.fn();
        const onExecuted = vi.fn<ActionApprovalContinuation['onExecuted']>(async (_artifact) => {
            deliveryObservedCustody(hook.getCurrent().approvalId);
            return 'consumed' as const;
        });

        act(() => hook.getCurrent().requestApproval({ artifactId, onExecuted }));
        await waitForHomeGovernance(() => expect(hook.getCurrent().approvalStatus).toBe('open'));
        expect(hook.getCurrent().approvalPending).toBe(true);

        await expect(decideApprovalAsInbox(serverId, artifactId, 'approve')).resolves.toMatchObject({
            ok: true, result: { status: 'executed' },
        });

        await waitForHomeGovernance(() => expect(onExecuted).toHaveBeenCalledTimes(1));
        expect(refresh).toHaveBeenCalledTimes(1);
        // Custody is released before the result is handed over, so a result
        // handler can never observe (or re-deliver) its own pending approval.
        expect(deliveryObservedCustody).toHaveBeenCalledWith(null);
        const delivered = onExecuted.mock.calls[0]?.[0];
        expect(delivered).toBeDefined();
        if (!delivered) throw new Error('Expected the executed approval Artifact');
        expect(delivered.id).toBe(artifactId);
        if (typeof delivered.body !== 'string') throw new Error('Expected the executed approval Artifact body');
        expect(ApprovalRequestV2Schema.parse(JSON.parse(delivered.body))).toMatchObject({
            status: 'executed',
            execution: { ok: true },
        });

        await hook.rerender({ scopeKey: `${serverId}:${ACCOUNT_ID}` });
        expect(onExecuted).toHaveBeenCalledTimes(1);
        expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(1);
    });

    it('hands a chained result-bearing Action to the same owner after the first result is claimed', async () => {
        const serverId = await addApprovalHome();
        answerRename(serverId);
        const firstId = await openRenameApproval(serverId, 'rename-first');
        const secondId = await openRenameApproval(serverId, 'rename-second', 'Renamed again');
        const hook = await renderContinuation(serverId);
        const secondResult = vi.fn(async () => 'consumed' as const);
        const firstResult = vi.fn(async () => {
            hook.getCurrent().requestApproval({ artifactId: secondId, onExecuted: secondResult });
            return 'consumed' as const;
        });

        act(() => hook.getCurrent().requestApproval({ artifactId: firstId, onExecuted: firstResult }));
        await decideApprovalAsInbox(serverId, firstId, 'approve');
        await waitForHomeGovernance(() => expect(firstResult).toHaveBeenCalledOnce());
        await waitForHomeGovernance(() => expect(hook.getCurrent().approvalId).toBe(secondId));
        expect(secondResult).not.toHaveBeenCalled();

        await decideApprovalAsInbox(serverId, secondId, 'approve');
        await waitForHomeGovernance(() => expect(secondResult).toHaveBeenCalledOnce());
        expect(hook.getCurrent().approvalId).toBeNull();
    });

    it.each([
        { status: 'rejected' as const, decision: 'reject' as const, homeAnswer: null },
        // The Home refuses the replayed rename, so execution settles failed.
        { status: 'failed' as const, decision: 'approve' as const, homeAnswer: { status: 409, body: { error: 'team_archived' } } },
    ])('releases $status custody with its typed body and restores retry', async ({ status, decision, homeAnswer }) => {
        const serverId = await addApprovalHome();
        if (homeAnswer) harness.answer(serverId, TEAM_UPDATE_PATH, homeAnswer);
        const artifactId = await openRenameApproval(serverId, `rename-${status}`);
        const hook = await renderContinuation(serverId);
        const onExecuted = vi.fn(async () => 'consumed' as const);
        const onTerminal = vi.fn();

        act(() => hook.getCurrent().requestApproval({ artifactId, onExecuted, onTerminal }));
        await waitForHomeGovernance(() => expect(hook.getCurrent().approvalStatus).toBe('open'));
        await decideApprovalAsInbox(serverId, artifactId, decision);

        await waitForHomeGovernance(() => expect(onTerminal).toHaveBeenCalledOnce());
        const [terminalStatus, artifact] = onTerminal.mock.calls[0] as [string, { id: string; body: unknown }];
        expect(terminalStatus).toBe(status);
        expect(artifact.id).toBe(artifactId);
        expect(typeof artifact.body).toBe('string');
        expect(onExecuted).not.toHaveBeenCalled();
        expect(hook.getCurrent().approvalId).toBeNull();
        expect(hook.getCurrent().approvalPending).toBe(false);
    });

    it('keeps custody through a transport failure so the same approval can still settle', async () => {
        const serverId = await addApprovalHome();
        const artifactId = await openRenameApproval(serverId, 'rename-unreachable');
        harness.answer(serverId, `GET /v1/artifacts/${artifactId}`, { status: 503, body: { error: 'unavailable' } });
        const hook = await renderContinuation(serverId);
        const onTerminal = vi.fn();

        act(() => hook.getCurrent().requestApproval({ artifactId, onExecuted: vi.fn(), onTerminal }));
        await waitForHomeGovernance(() => expect(hook.getCurrent().error).toBe(true));

        expect(hook.getCurrent().invalidArtifact).toBe(false);
        expect(hook.getCurrent().approvalId).toBe(artifactId);
        expect(hook.getCurrent().approvalPending).toBe(true);
        expect(onTerminal).not.toHaveBeenCalled();
    });

    it('clears an Artifact the Home serves whose header contradicts its approval body', async () => {
        const serverId = await addApprovalHome();
        const genuineId = await openRenameApproval(serverId, 'rename-genuine');
        const genuineBody = harness.artifacts(serverId).readPlainBody(genuineId);
        const genuine = ApprovalRequestV2Schema.parse(genuineBody === null ? null : JSON.parse(genuineBody));
        // Any client of the Home's Artifact route can store this row; the reader
        // must refuse it rather than wait on it forever.
        const { captureActionAccountContext } = await import('@/sync/ops/actions/actionAccountContext');
        const context = await captureActionAccountContext(serverId, new AbortController().signal);
        let contradictoryId: string;
        try {
            contradictoryId = await context.createArtifact(
                buildApprovalRequestArtifactHeaderV1({ ...genuine, actionId: 'teams.archive' }),
                JSON.stringify(genuine),
            );
        } finally {
            context.dispose();
        }
        const hook = await renderContinuation(serverId);
        const onTerminal = vi.fn();

        act(() => hook.getCurrent().requestApproval({ artifactId: contradictoryId, onExecuted: vi.fn(), onTerminal }));

        await waitForHomeGovernance(() => expect(onTerminal).toHaveBeenCalledWith('invalid', null));
        expect(hook.getCurrent().approvalId).toBeNull();
    });

    it('discards process-local custody when the exact scope changes', async () => {
        const serverId = await addApprovalHome();
        const artifactId = await openRenameApproval(serverId, 'rename-scope');
        const hook = await renderContinuation(serverId);

        act(() => hook.getCurrent().requestApproval({ artifactId, onExecuted: vi.fn() }));
        expect(hook.getCurrent().approvalId).toBe(artifactId);

        await hook.rerender({ scopeKey: `${serverId}:account-b` });
        expect(hook.getCurrent().approvalId).toBeNull();
    });
});
