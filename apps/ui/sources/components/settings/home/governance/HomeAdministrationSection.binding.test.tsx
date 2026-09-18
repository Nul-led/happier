import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep this shell test independent from unrelated generated plugin artifacts.
// These are the same canonical testkit owners re-exported by `@/dev/testkit`.
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { homeGovernanceProjectionFixture } from '@/dev/testkit/fixtures/homeGovernanceFixtures';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import type { HomeAdministrationBinding } from '@/hooks/home/useHomeAdministration';
import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';
import type { HomeAdministrationContext } from './homeAdministrationContext';

const useHomeAdministration = vi.hoisted(() => vi.fn());
const refreshHomeGovernanceSnapshot = vi.hoisted(() => vi.fn());
type ApprovalArtifactHookResult = Readonly<{
    artifact: DecryptedArtifact | null;
    isLoading: boolean;
    error: boolean | null;
    invalidArtifact: boolean;
}>;
const useApprovalArtifact = vi.hoisted(() => vi.fn<() => ApprovalArtifactHookResult>(() => ({
    artifact: null,
    isLoading: false,
    error: null,
    invalidArtifact: false,
})));

vi.mock('@/hooks/home/useHomeAdministration', () => ({ useHomeAdministration }));
vi.mock('@/components/approvals/useApprovalArtifact', () => ({ useApprovalArtifact }));
vi.mock('@/sync/engine/home/governance/homeGovernanceEngine', () => ({ refreshHomeGovernanceSnapshot }));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
}));
// App-bundled plugin bytes are a generated build boundary and unrelated to this shell.
// The synchronized test target intentionally has no generated inventory.
vi.mock('@/sync/domains/plugins/availability/bundledAppExactArtifactSource', () => ({
    createBundledPluginUiAppExactArtifactSource: () => Object.freeze({
        kind: 'appExact' as const,
        readFile: async () => null,
    }),
    createBundledPluginUiAppExactArtifactSourceFromInventory: () => Object.freeze({
        kind: 'appExact' as const,
        readFile: async () => null,
    }),
}));
vi.mock('@/sync/domains/plugins/availability/reader', () => ({
    createPluginAccountAvailabilityReader: vi.fn(),
    createPluginAccountAvailabilityReaderStore: () => Object.freeze({
        replace: () => null,
        clear: () => null,
        subscribe: () => () => undefined,
        bind: vi.fn(),
    }),
    projectPluginAccountAvailabilityMaterializationIdentity: vi.fn(),
}));

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: vi.fn() }),
        useNavigation: () => ({ setOptions: vi.fn() }),
    }),
});

function readyBinding(accountId: string): Extract<HomeAdministrationBinding, { kind: 'bound' }> {
    const scope = { serverId: 'home-1', accountId };
    return {
        kind: 'bound',
        scope,
        homeName: 'Home One',
        state: {
            kind: 'ready',
            scope,
            projection: homeGovernanceProjectionFixture(),
            refreshing: false,
            stale: false,
            lastObservedAt: 1,
            mutationsAvailable: true,
            error: null,
        },
    };
}

function approvalArtifact(
    id: string,
    status: 'executed' | 'rejected' | 'failed' | 'canceled',
): DecryptedArtifact {
    return {
        id,
        title: null,
        header: { title: null, approvalStatus: status },
        body: '{}',
        headerVersion: 1,
        bodyVersion: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 2,
        isDecrypted: true,
    };
}

let nextMountId = 0;
const renderedContexts: HomeAdministrationContext[] = [];
let HomeAdministrationSection: typeof import('./HomeAdministrationSection')['HomeAdministrationSection'];

function ChildProbe(props: Readonly<{ context: HomeAdministrationContext }>) {
    const [mountId] = React.useState(() => ++nextMountId);
    renderedContexts.push(props.context);
    return React.createElement('HomeAdministrationSectionProbe', {
        testID: 'home-admin-child-probe',
        mountId,
        accountId: props.context.scope.accountId,
    });
}

describe('HomeAdministrationSection Account binding', () => {
    beforeAll(async () => {
        ({ HomeAdministrationSection } = await import('./HomeAdministrationSection'));
    }, 120_000);

    afterAll(() => {
        standardCleanup();
    });

    beforeEach(() => {
        standardCleanup();
        useHomeAdministration.mockReset();
        useApprovalArtifact.mockReset();
        useApprovalArtifact.mockReturnValue({ artifact: null, isLoading: false, error: null, invalidArtifact: false });
        refreshHomeGovernanceSnapshot.mockReset();
        renderedContexts.length = 0;
        nextMountId = 0;
    });

    afterEach(() => standardCleanup());

    it('remounts section-local state and rejects a stale approval registration after the bound Account changes', async () => {
        useHomeAdministration.mockReturnValue(readyBinding('account-a'));
        const renderSection = (title: string) => (
            <HomeAdministrationSection serverId="home-1" title={title}>
                {(context) => <ChildProbe context={context} />}
            </HomeAdministrationSection>
        );
        const screen = await renderScreen(renderSection('Home A'));
        const firstMountId = screen.findByTestId('home-admin-child-probe')?.props.mountId;
        const staleRequestApproval = renderedContexts.at(-1)!.requestApproval!;

        useHomeAdministration.mockReturnValue(readyBinding('account-b'));
        await act(async () => {
            screen.tree.update(renderSection('Home B'));
        });

        expect(screen.findByTestId('home-admin-child-probe')?.props.accountId).toBe('account-b');
        expect(screen.findByTestId('home-admin-child-probe')?.props.mountId).not.toBe(firstMountId);

        // A mutation begun as the previous Account must not hand its approval to
        // the Account now bound to this Home.
        await act(async () => staleRequestApproval('approval-from-account-a'));
        expect(screen.findByTestId('home-admin-approval')).toBeNull();
    });

    it.each(['rejected', 'failed', 'canceled'] as const)(
        'releases a %s approval so Home administration restores mutation availability without refreshing',
        async (status) => {
            useHomeAdministration.mockReturnValue(readyBinding('account-a'));
            const renderSection = () => (
                <HomeAdministrationSection serverId="home-1" title="Home A">
                    {(context) => <ChildProbe context={context} />}
                </HomeAdministrationSection>
            );
            const screen = await renderScreen(renderSection());
            const onTerminal = vi.fn();

            await act(async () => renderedContexts.at(-1)!.requestApproval!({
                artifactId: 'approval-home-1',
                onExecuted: vi.fn(async () => 'consumed' as const),
                onTerminal,
            }));
            await vi.waitFor(() => expect(screen.findByTestId('home-admin-approval')).not.toBeNull());
            expect(renderedContexts.at(-1)!.mutationsAvailable).toBe(false);

            // The approval is decided in the Inbox rather than here, so the shell
            // observes it through the shared artifact reader.
            useApprovalArtifact.mockReturnValue({
                artifact: approvalArtifact('approval-home-1', status),
                isLoading: false,
                error: null,
                invalidArtifact: false,
            });
            await act(async () => {
                screen.tree.update(renderSection());
            });

            await vi.waitFor(() => expect(screen.findByTestId('home-admin-approval')).toBeNull());
            expect(onTerminal).toHaveBeenCalledOnce();
            expect(onTerminal).toHaveBeenCalledWith(status, expect.objectContaining({ id: 'approval-home-1' }));
            expect(renderedContexts.at(-1)!.approvalPending).toBe(false);
            expect(renderedContexts.at(-1)!.mutationsAvailable).toBe(true);
            expect(refreshHomeGovernanceSnapshot).not.toHaveBeenCalled();
        },
    );

    it('delivers one executed Artifact to the exact process-local continuation and never redelivers it', async () => {
        useHomeAdministration.mockReturnValue(readyBinding('account-a'));
        const renderSection = () => (
            <HomeAdministrationSection serverId="home-1" title="Home A">
                {(context) => <ChildProbe context={context} />}
            </HomeAdministrationSection>
        );
        const screen = await renderScreen(renderSection());
        const onExecuted = vi.fn(async () => 'consumed' as const);

        await act(async () => renderedContexts.at(-1)!.requestApproval!({
            artifactId: 'approval-home-result',
            onExecuted,
        }));
        await vi.waitFor(() => expect(screen.findByTestId('home-admin-approval')).not.toBeNull());
        expect(renderedContexts.at(-1)!.mutationsAvailable).toBe(false);

        useApprovalArtifact.mockReturnValue({
            artifact: approvalArtifact('approval-home-result', 'executed'),
            isLoading: false,
            error: null,
            invalidArtifact: false,
        });
        await act(async () => {
            screen.tree.update(renderSection());
        });

        await vi.waitFor(() => expect(onExecuted).toHaveBeenCalledTimes(1));
        expect(refreshHomeGovernanceSnapshot).toHaveBeenCalledOnce();
        expect(refreshHomeGovernanceSnapshot).toHaveBeenCalledWith({ serverId: 'home-1', accountId: 'account-a' });
        expect(screen.findByTestId('home-admin-approval')).toBeNull();
        expect(renderedContexts.at(-1)!.approvalPending).toBe(false);
        expect(renderedContexts.at(-1)!.mutationsAvailable).toBe(true);

        await act(async () => {
            screen.tree.update(renderSection());
        });
        expect(onExecuted).toHaveBeenCalledTimes(1);
        expect(refreshHomeGovernanceSnapshot).toHaveBeenCalledTimes(1);
    });
});
