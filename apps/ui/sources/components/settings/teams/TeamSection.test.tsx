import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep this shell test independent from unrelated generated plugin artifacts.
// These are the same canonical testkit owners re-exported by `@/dev/testkit`.
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { teamCapabilitiesFixture, teamSummaryFixture } from '@/dev/testkit/fixtures/teamFixtures';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import type { TeamBinding } from '@/hooks/teams/useTeamBinding';
import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';

import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';
import type { TeamSectionContext } from './teamSectionContext';

const useTeamBinding = vi.hoisted(() => vi.fn());
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

vi.mock('@/hooks/teams/useTeamBinding', () => ({ useTeamBinding }));
vi.mock('@/components/approvals/useApprovalArtifact', () => ({ useApprovalArtifact }));
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

function readyBinding(accountId: string): Extract<TeamBinding, { kind: 'bound' }> {
    const scope = { serverId: 'home-1', accountId };
    const address = { serverId: 'home-1', teamId: 'team-1' };
    const team = teamSummaryFixture({
        capabilities: teamCapabilitiesFixture({ manageSettings: true }),
    });
    return {
        kind: 'bound',
        scope,
        address,
        homeName: 'Home One',
        snapshot: null,
        refresh: vi.fn(),
        state: {
            kind: 'ready',
            scope,
            address,
            team,
            refreshing: false,
            stale: false,
            lastObservedAt: 1,
            mutationsAvailable: true,
            archived: false,
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
const renderedContexts: TeamSectionContext[] = [];
let TeamSection: typeof import('./TeamSection')['TeamSection'];

function ChildProbe(props: Readonly<{ context: TeamSectionContext }>) {
    const [mountId] = React.useState(() => ++nextMountId);
    renderedContexts.push(props.context);
    return React.createElement('TeamSectionProbe', {
        testID: 'team-section-child-probe',
        mountId,
        accountId: props.context.scope.accountId,
    });
}

describe('TeamSection Account binding', () => {
    beforeAll(async () => {
        ({ TeamSection } = await import('./TeamSection'));
    }, 120_000);

    afterAll(() => {
        standardCleanup();
    });

    beforeEach(() => {
        standardCleanup();
        useTeamBinding.mockReset();
        useApprovalArtifact.mockReset();
        useApprovalArtifact.mockReturnValue({ artifact: null, isLoading: false, error: null, invalidArtifact: false });
        renderedContexts.length = 0;
        nextMountId = 0;
    });

    afterEach(() => standardCleanup());

    it('remounts section-local state and rejects a stale approval registration after AccountChange', async () => {
        useTeamBinding.mockReturnValue(readyBinding('account-a'));
        const renderSection = (title: string) => (
            <TeamSection serverId="home-1" teamId="team-1" title={title}>
                {(context) => <ChildProbe context={context} />}
            </TeamSection>
        );
        const screen = await renderScreen(renderSection('Team A'));
        const firstMountId = screen.findByTestId('team-section-child-probe')?.props.mountId;
        const staleRequestApproval = renderedContexts.at(-1)!.requestApproval;

        useTeamBinding.mockReturnValue(readyBinding('account-b'));
        await act(async () => {
            screen.tree.update(renderSection('Team B'));
        });

        expect(screen.findByTestId('team-section-child-probe')?.props.accountId).toBe('account-b');
        expect(screen.findByTestId('team-section-child-probe')?.props.mountId).not.toBe(firstMountId);

        await act(async () => staleRequestApproval('approval-from-account-a'));
        expect(screen.findByTestId('team-approval')).toBeNull();
    });

    it.each(['rejected', 'failed', 'canceled'] as const)(
        'releases a %s approval without refreshing or redispatching the Team mutation',
        async (status) => {
            const binding = readyBinding('account-a');
            useTeamBinding.mockReturnValue(binding);
            const renderSection = () => (
                <TeamSection serverId="home-1" teamId="team-1">
                    {(context) => <ChildProbe context={context} />}
                </TeamSection>
            );
            const screen = await renderScreen(renderSection());
            const onTerminal = vi.fn();

            await act(async () => renderedContexts.at(-1)!.requestApproval({
                artifactId: 'approval-terminal',
                onExecuted: vi.fn(async () => 'consumed' as const),
                onTerminal,
            }));
            await vi.waitFor(() => expect(screen.findByTestId('team-approval')).not.toBeNull());
            expect(renderedContexts.at(-1)!.canMutate).toBe(false);

            useApprovalArtifact.mockReturnValue({
                artifact: approvalArtifact('approval-terminal', status),
                isLoading: false,
                error: null,
                invalidArtifact: false,
            });
            await act(async () => screen.tree.update(renderSection()));

            await vi.waitFor(() => expect(screen.findByTestId('team-approval')).toBeNull());
            expect(onTerminal).toHaveBeenCalledOnce();
            expect(onTerminal).toHaveBeenCalledWith(status, expect.objectContaining({ id: 'approval-terminal' }));
            expect(renderedContexts.at(-1)!.approvalPending).toBe(false);
            expect(renderedContexts.at(-1)!.canMutate).toBe(true);
            expect(binding.refresh).not.toHaveBeenCalled();
        },
    );

    it('refreshes the exact Team and delivers its typed continuation exactly once after execution', async () => {
        const binding = readyBinding('account-a');
        useTeamBinding.mockReturnValue(binding);
        const renderSection = () => (
            <TeamSection serverId="home-1" teamId="team-1">
                {(context) => <ChildProbe context={context} />}
            </TeamSection>
        );
        const screen = await renderScreen(renderSection());
        const onExecuted = vi.fn(async () => 'consumed' as const);

        await act(async () => renderedContexts.at(-1)!.requestApproval({
            artifactId: 'approval-executed',
            onExecuted,
        }));
        await vi.waitFor(() => expect(screen.findByTestId('team-approval')).not.toBeNull());
        expect(renderedContexts.at(-1)!.canMutate).toBe(false);
        useApprovalArtifact.mockReturnValue({
            artifact: approvalArtifact('approval-executed', 'executed'),
            isLoading: false,
            error: null,
            invalidArtifact: false,
        });
        await act(async () => screen.tree.update(renderSection()));

        await vi.waitFor(() => expect(onExecuted).toHaveBeenCalledOnce());
        expect(binding.refresh).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('team-approval')).toBeNull();
        expect(renderedContexts.at(-1)!.approvalPending).toBe(false);
        expect(renderedContexts.at(-1)!.canMutate).toBe(true);

        await act(async () => screen.tree.update(renderSection()));
        expect(onExecuted).toHaveBeenCalledTimes(1);
        expect(binding.refresh).toHaveBeenCalledTimes(1);
    });
});
