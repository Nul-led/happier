import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    REMOVE_INDEX_LOCK_CONFIRMATION_TOKEN,
    SCM_OPERATION_ERROR_CODES,
} from '@happier-dev/protocol';
import { renderScreen } from '@/dev/testkit';
import {
    installSourceControlBranchMenuCommonModuleMocks,
    listSourceControlBranchMenuItemIds,
    openSourceControlBranchMenu,
    resetSourceControlBranchMenuCommonModuleMockState,
    selectSourceControlBranchMenuItem,
    sourceControlBranchMenuModuleState,
} from './gitBranchButtonTestHelpers';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSourceControlBranchMenuCommonModuleMocks();

describe('GitBranchButton', () => {
    beforeEach(() => {
        resetSourceControlBranchMenuCommonModuleMockState();
    });

    it('keeps the branch list visible while write operations are disabled', async () => {
        sourceControlBranchMenuModuleState.useSettingMock.mockImplementation(() => 'always_bring');
        sourceControlBranchMenuModuleState.fetchBranchesForSessionMock.mockResolvedValue([
            { name: 'existing-branch', type: 'local', isCurrent: true, upstream: null },
            { name: 'feature/test', type: 'local', isCurrent: false, upstream: null },
        ]);

        const { GitBranchButton } = await import('./GitBranchButton');

        const screen = await renderScreen(<GitBranchButton
                    sessionId="s1"
                    snapshot={{
                        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                        branch: { head: 'existing-branch', upstream: null, ahead: 0, behind: 0, detached: false },
                        capabilities: { readBranches: true, writeBranchCheckout: true, writeBranchCreate: true, writeRemotePublish: true },
                        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
                        fetchedAt: Date.now(),
                        projectKey: 'p1',
                        hasConflicts: false,
                        entries: [],
                        stashCount: 0,
                    } as any}
                    disabled
                />);

        await openSourceControlBranchMenu(screen);
        const itemIds = listSourceControlBranchMenuItemIds(screen);
        const results = screen.findByType('SelectableMenuResults' as any);
        const branchItem = results.props.categories
            .flatMap((category: any) => category.items)
            .find((item: any) => item.id === 'branch:feature/test');

        expect(itemIds.includes('publish')).toBe(false);
        expect(branchItem?.disabled).toBe(true);
        expect(sourceControlBranchMenuModuleState.fetchBranchesForSessionMock).toHaveBeenCalledWith({
            sessionId: 's1',
            includeRemotes: false,
        });
    });

    it('seeds the branch menu from the shared branch cache before refreshing', async () => {
        sourceControlBranchMenuModuleState.useSettingMock.mockImplementation(() => 'always_bring');
        sourceControlBranchMenuModuleState.readCachedBranchesForSessionMock.mockReturnValue([
            { name: 'cached-branch', type: 'local', isCurrent: false, upstream: null },
        ]);
        sourceControlBranchMenuModuleState.fetchBranchesForSessionMock.mockImplementation(() => new Promise(() => {}));

        const { GitBranchButton } = await import('./GitBranchButton');

        const screen = await renderScreen(<GitBranchButton
                    sessionId="s1"
                    snapshot={{
                        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                        capabilities: { readBranches: true, writeBranchCheckout: true, writeRemotePublish: true },
                        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
                        fetchedAt: Date.now(),
                        projectKey: 'p1',
                        hasConflicts: false,
                        entries: [],
                        stashCount: 0,
                    } as any}
                    disabled={false}
                />);

        await openSourceControlBranchMenu(screen);
        expect(listSourceControlBranchMenuItemIds(screen)).toContain('branch:cached-branch');
        expect(sourceControlBranchMenuModuleState.fetchBranchesForSessionMock).toHaveBeenCalledWith({
            sessionId: 's1',
            includeRemotes: false,
        });
    });

    it('keeps cached branches visible when refresh fails', async () => {
        sourceControlBranchMenuModuleState.useSettingMock.mockImplementation(() => 'always_bring');
        sourceControlBranchMenuModuleState.readCachedBranchesForSessionMock.mockReturnValue([
            { name: 'cached-branch', type: 'local', isCurrent: false, upstream: null },
        ]);
        sourceControlBranchMenuModuleState.fetchBranchesForSessionMock.mockRejectedValue(new Error('refresh failed'));

        const { GitBranchButton } = await import('./GitBranchButton');

        const screen = await renderScreen(<GitBranchButton
                    sessionId="s1"
                    snapshot={{
                        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                        capabilities: { readBranches: true, writeBranchCheckout: true, writeRemotePublish: true },
                        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
                        fetchedAt: Date.now(),
                        projectKey: 'p1',
                        hasConflicts: false,
                        entries: [],
                        stashCount: 0,
                    } as any}
                    disabled={false}
                />);

        await openSourceControlBranchMenu(screen);
        await act(async () => {
            try {
                await sourceControlBranchMenuModuleState.fetchBranchesForSessionMock.mock.results[0]?.value;
            } catch {}
        });
        expect(listSourceControlBranchMenuItemIds(screen)).toContain('branch:cached-branch');
        // The failure is said in the list, next to what is still shown — never as a dialog.
        expect(listSourceControlBranchMenuItemIds(screen)).toContain('load-error');
        expect(sourceControlBranchMenuModuleState.modalAlertSpy).not.toHaveBeenCalled();
    });

    it('allows the branch menu popover to grow wider than the branch trigger', async () => {
        sourceControlBranchMenuModuleState.useSettingMock.mockImplementation(() => 'always_bring');
        sourceControlBranchMenuModuleState.fetchBranchesForSessionMock.mockResolvedValue([]);
        sourceControlBranchMenuModuleState.sessionScmBranchCreateMock.mockResolvedValue({ success: true });

        const { GitBranchButton } = await import('./GitBranchButton');

        const screen = await renderScreen(<GitBranchButton
                    sessionId="s1"
                    snapshot={{
                        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                        branch: { head: 'existing-branch', upstream: null, ahead: 0, behind: 0, detached: false },
                        capabilities: { readBranches: true, writeBranchCheckout: true, writeRemotePublish: true },
                        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
                        fetchedAt: Date.now(),
                        projectKey: 'p1',
                        hasConflicts: false,
                        entries: [],
                        stashCount: 0,
                    } as any}
                    disabled={false}
                />);

        expect(screen.findByType('Popover' as any).props.maxWidthCap).toBe(420);
    });

    it('switches branches using bring_changes when setting is always_bring', async () => {
        sourceControlBranchMenuModuleState.useSettingMock.mockImplementation((key: string) => {
            if (key === 'scmUncommittedChangesStrategy') return 'always_bring';
            if (key === 'scmAskBeforeOverwritingBranchStash') return true;
            return undefined;
        });
        sourceControlBranchMenuModuleState.fetchBranchesForSessionMock.mockResolvedValue([
            { name: 'main', type: 'local', isCurrent: true, upstream: null },
            { name: 'feature/test', type: 'local', isCurrent: false, upstream: null },
        ]);
        sourceControlBranchMenuModuleState.sessionScmBranchCreateMock.mockResolvedValue({ success: true });
        sourceControlBranchMenuModuleState.sessionScmBranchCheckoutMock.mockResolvedValue({ success: true });

        const { GitBranchButton } = await import('./GitBranchButton');

        const screen = await renderScreen(<GitBranchButton
                    sessionId="s1"
                    snapshot={{
                        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                        capabilities: { readBranches: true, writeBranchCheckout: true, writeRemotePublish: true },
                        totals: { includedFiles: 1, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
                        fetchedAt: Date.now(),
                        projectKey: 'p1',
                        hasConflicts: false,
                        entries: [],
                        stashCount: 0,
                    } as any}
                    disabled={false}
                />);

        await openSourceControlBranchMenu(screen);
        await selectSourceControlBranchMenuItem(screen, 'branch:feature/test');

        expect(sourceControlBranchMenuModuleState.sessionScmBranchCheckoutMock).toHaveBeenCalledWith('s1', {
            name: 'feature/test',
            strategy: 'bring_changes',
        }, undefined);
    });

    it('offers stale Git index-lock recovery and retries branch checkout once', async () => {
        sourceControlBranchMenuModuleState.useSettingMock.mockImplementation((key: string) => {
            if (key === 'scmUncommittedChangesStrategy') return 'always_bring';
            if (key === 'scmAskBeforeOverwritingBranchStash') return true;
            return undefined;
        });
        sourceControlBranchMenuModuleState.modalConfirmSpy.mockResolvedValue(true);
        sourceControlBranchMenuModuleState.fetchBranchesForSessionMock.mockResolvedValue([
            { name: 'main', type: 'local', isCurrent: true, upstream: null },
            { name: 'feature/test', type: 'local', isCurrent: false, upstream: null },
        ]);
        sourceControlBranchMenuModuleState.sessionScmBranchCheckoutMock
            .mockResolvedValueOnce({
                success: false,
                errorCode: SCM_OPERATION_ERROR_CODES.COMMAND_FAILED,
                error: "fatal: Unable to create '/repo/.git/index.lock': File exists.",
            })
            .mockResolvedValueOnce({ success: true });

        const { GitBranchButton } = await import('./GitBranchButton');

        const screen = await renderScreen(<GitBranchButton
                    sessionId="s1"
                    snapshot={{
                        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                        capabilities: { readBranches: true, writeBranchCheckout: true, writeRemotePublish: true },
                        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
                        fetchedAt: Date.now(),
                        projectKey: 'p1',
                        hasConflicts: false,
                        entries: [],
                        stashCount: 0,
                    } as any}
                    disabled={false}
                />);

        await openSourceControlBranchMenu(screen);
        await selectSourceControlBranchMenuItem(screen, 'branch:feature/test');

        expect(sourceControlBranchMenuModuleState.modalConfirmSpy).toHaveBeenCalledTimes(1);
        expect(sourceControlBranchMenuModuleState.sessionScmRepositoryRemoveIndexLockMock).toHaveBeenCalledWith('s1', {
            cwd: '/repo',
            confirmed: true,
            confirmationToken: REMOVE_INDEX_LOCK_CONFIRMATION_TOKEN,
        }, undefined);
        expect(sourceControlBranchMenuModuleState.sessionScmBranchCheckoutMock).toHaveBeenCalledTimes(2);
        expect(sourceControlBranchMenuModuleState.modalAlertSpy).not.toHaveBeenCalled();
    });


    it('reports a failed switch into the operation log the pane shows, without a dialog', async () => {
        sourceControlBranchMenuModuleState.useSettingMock.mockImplementation((key: string) => (
            key === 'scmUncommittedChangesStrategy' ? 'always_bring' : undefined
        ));
        sourceControlBranchMenuModuleState.fetchBranchesForSessionMock.mockResolvedValue([
            { name: 'main', type: 'local', isCurrent: true, upstream: 'origin/main' },
            { name: 'dev', type: 'local', isCurrent: false, upstream: 'origin/dev' },
        ]);
        sourceControlBranchMenuModuleState.sessionScmBranchCheckoutMock.mockResolvedValue({
            success: false, error: 'error: Your local changes would be overwritten by checkout',
        });

        const { GitBranchButton } = await import('./GitBranchButton');
        const screen = await renderScreen(<GitBranchButton sessionId="s1" snapshot={SNAPSHOT} />);
        await openSourceControlBranchMenu(screen);
        await selectSourceControlBranchMenuItem(screen, 'branch:dev');

        expect(sourceControlBranchMenuModuleState.operationLog[0]).toMatchObject({ operation: 'branch_switch', status: 'failed' });
        expect(sourceControlBranchMenuModuleState.modalAlertSpy).not.toHaveBeenCalled();
    });

    it('keeps the changes aside through the operation owner, and offers it only where the daemon can', async () => {
        sourceControlBranchMenuModuleState.useSettingMock.mockImplementation(() => undefined);
        sourceControlBranchMenuModuleState.fetchBranchesForSessionMock.mockResolvedValue([
            { name: 'main', type: 'local', isCurrent: true, upstream: 'origin/main' },
        ]);
        sourceControlBranchMenuModuleState.sessionScmStashCreateMock.mockResolvedValue({ success: true, stashCreated: true, stashRef: 'stash@{0}' });

        const { GitBranchButton } = await import('./GitBranchButton');
        const screen = await renderScreen(<GitBranchButton sessionId="s1" snapshot={SNAPSHOT} />);
        await openSourceControlBranchMenu(screen);
        await selectSourceControlBranchMenuItem(screen, 'git:keep-aside');

        expect(sourceControlBranchMenuModuleState.sessionScmStashCreateMock).toHaveBeenCalledWith('s1', {}, undefined);
        expect(sourceControlBranchMenuModuleState.operationLog[0]).toMatchObject({ operation: 'stash_create', status: 'success', detail: 'stash@{0}' });

        const oldDaemon = await renderScreen(<GitBranchButton
            sessionId="s1"
            snapshot={{ ...SNAPSHOT, capabilities: { ...SNAPSHOT.capabilities, writeStashCreate: undefined } } as any}
        />);
        await openSourceControlBranchMenu(oldDaemon);
        expect(listSourceControlBranchMenuItemIds(oldDaemon)).not.toContain('git:keep-aside');
    });

});

const SNAPSHOT = {
                        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                        branch: { head: 'main', upstream: 'origin/main', ahead: 0, behind: 0, detached: false },
                        capabilities: { readBranches: true, writeBranchCheckout: true, writeStashCreate: true, readStash: true },
                        totals: { includedFiles: 0, pendingFiles: 2, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
                        fetchedAt: Date.now(),
                        projectKey: 'p1',
                        hasConflicts: false,
                        entries: [
                            { path: 'a.ts', previousPath: null, kind: 'modified', includeStatus: ' ', pendingStatus: 'M', hasIncludedDelta: false, hasPendingDelta: true, stats: { includedAdded: 0, includedRemoved: 0, pendingAdded: 1, pendingRemoved: 0, isBinary: false } },
                            { path: 'b.ts', previousPath: null, kind: 'modified', includeStatus: ' ', pendingStatus: 'M', hasIncludedDelta: false, hasPendingDelta: true, stats: { includedAdded: 0, includedRemoved: 0, pendingAdded: 1, pendingRemoved: 0, isBinary: false } },
                        ],
                        stashCount: 0,
                    } as any;
