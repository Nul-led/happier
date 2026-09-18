import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ApprovalRequestV2Schema,
    buildApprovalRequestArtifactHeaderV1,
    decodePlainArtifactStoredContent,
} from '@happier-dev/protocol';

import {
    collectRenderedTestIds,
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
    renderScreen,
    standardCleanup,
    accountDisplayProfileFixture,
    teamCapabilitiesFixture,
    teamCredentialResourceFixture,
    teamMembershipFixture,
    teamSummaryFixture,
} from '@/dev/testkit';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const clipboardSet = vi.hoisted(() => vi.fn(async () => undefined));
const modalConfirm = vi.hoisted(() => vi.fn(async () => true));
const routerReplace = vi.hoisted(() => vi.fn());
const shownModals = vi.hoisted(() => [] as { chrome?: { testID?: string }; props?: Record<string, unknown> }[]);
const navigationState = vi.hoisted(() => ({
    dispatch: vi.fn(),
    setOptions: vi.fn(),
    preventRemove: false,
    onPreventRemove: null as null | ((event: { data: { action: unknown } }) => void),
}));
const approvalArtifactState = vi.hoisted(() => ({
    value: {
        artifact: null as null | Readonly<Record<string, unknown> & { id: string }>,
        isLoading: false,
        error: null as boolean | null,
        invalidArtifact: false,
    },
    requested: [] as (string | null)[],
    listeners: new Set<() => void>(),
}));

vi.mock('@/components/approvals/useApprovalArtifact', () => ({
    useApprovalArtifact: (input: Readonly<{ artifactId: string | null }>) => {
        const held = React.useSyncExternalStore(
            (listener) => {
                approvalArtifactState.listeners.add(listener);
                return () => approvalArtifactState.listeners.delete(listener);
            },
            () => approvalArtifactState.value,
            () => approvalArtifactState.value,
        );
        approvalArtifactState.requested.push(input.artifactId);
        return {
            ...held,
            artifact: held.artifact?.id === input.artifactId ? held.artifact : null,
            homeUnavailable: false,
            refresh: async () => {},
        };
    },
}));

vi.mock('expo-clipboard', () => ({
    setStringAsync: clipboardSet,
    getStringAsync: vi.fn(async () => ''),
}));

vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock({
        navigation: {
            dispatch: navigationState.dispatch,
            setOptions: navigationState.setOptions,
        },
        usePreventRemove: (
            preventRemove: boolean,
            callback: (event: { data: { action: unknown } }) => void,
        ) => {
            navigationState.preventRemove = preventRemove;
            navigationState.onPreventRemove = callback;
        },
    });
});

vi.mock('@/sync/api/capabilities/accountStoredContentCompatibility', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/capabilities/accountStoredContentCompatibility')>(),
    requireCurrentAccountStoredContentServerCompatibility: vi.fn(async () => undefined),
}));

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: routerReplace }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                confirm: modalConfirm,
                show: (config) => {
                    shownModals.push(config as (typeof shownModals)[number]);
                    return 'modal-id';
                },
            },
        }).module;
    },
});

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const TEAM_GET_PATH = '/v1/teams/get';
const CREDENTIAL_GET_PATH = '/v1/teams/credential-resources/get';
const EXTERNAL_KEYS_LIST_PATH = '/v1/teams/credential-resources/external-keys/list';
const EXTERNAL_KEY_CREATE_PATH = '/v1/teams/credential-resources/external-keys/create';
const EXTERNAL_KEY_REVOKE_PATH = '/v1/teams/credential-resources/external-keys/revoke';
const EXTERNAL_KEY_REVOKE_ALL_PATH = '/v1/teams/credential-resources/external-keys/revoke-all';
const MEMBERS_LIST_PATH = '/v1/teams/members/list';
const ACCOUNT_SETTINGS_V2_PATH = '/v2/account/settings';
const ARTIFACT_CREATE_PATH = '/v1/artifacts';
const CREATED_KEY_ID = '550e8400-e29b-41d4-a716-446655440000';
const CREATED_TOKEN = `hapek_v1_${CREATED_KEY_ID}_${'a'.repeat(43)}`;

function key(keyId: string, resourceId: string, label: string) {
    return {
        keyId,
        resourceId,
        teamMembershipId: 'membership-1',
        label,
        displayPrefix: `hapek_v1_${keyId.slice(0, 8)}`,
        createdAt: '2026-09-07T10:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
    };
}

function readOpenApprovalArtifact() {
    const input = harness.requestsFor(ARTIFACT_CREATE_PATH).at(-1)?.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('approval_artifact_request_missing');
    }
    const id = Reflect.get(input, 'id');
    const storedBody = Reflect.get(input, 'body');
    if (typeof id !== 'string' || typeof storedBody !== 'string') {
        throw new Error('approval_artifact_request_invalid');
    }
    const decoded = decodePlainArtifactStoredContent(storedBody);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
        throw new Error('approval_artifact_envelope_invalid');
    }
    const body = Reflect.get(decoded, 'body');
    const request = ApprovalRequestV2Schema.parse(typeof body === 'string' ? JSON.parse(body) : null);
    return { id, request };
}

async function settleApproval(status: 'executed' | 'canceled', result?: unknown): Promise<void> {
    const { id, request } = readOpenApprovalArtifact();
    await vi.waitFor(() => expect(approvalArtifactState.requested).toContain(id));
    const updatedAtMs = request.updatedAtMs + 1;
    const settled = ApprovalRequestV2Schema.parse(status === 'executed'
        ? {
            ...request,
            status,
            updatedAtMs,
            decision: { kind: 'approve', decidedAtMs: updatedAtMs },
            execution: { executedAtMs: updatedAtMs, ok: true, result },
        }
        : {
            ...request,
            status,
            updatedAtMs,
        });
    await act(async () => {
        approvalArtifactState.value = {
            artifact: {
                id,
                title: null,
                header: buildApprovalRequestArtifactHeaderV1(settled),
                body: JSON.stringify(settled),
                headerVersion: 2,
                bodyVersion: 2,
                seq: 2,
                createdAt: request.createdAtMs,
                updatedAt: updatedAtMs,
                isDecrypted: true,
            },
            isLoading: false,
            error: null,
            invalidArtifact: false,
        };
        for (const listener of approvalArtifactState.listeners) listener();
        await Promise.resolve();
    });
}

async function addManagedHome(initialKeys: readonly ReturnType<typeof key>[] = []): Promise<string> {
    const serverId = await harness.addHome({
        name: 'Home A', serverUrl: 'https://private-home.example', publicServerUrl: 'https://external-api-approval.example', accountId: 'account-ada',
        teamsEnabled: true, credentialResourcesEnabled: true,
        credentialResourcesExternalApiEnabled: true,
        credentialResourcesExternalApiAvailability: {
            available: true,
            baseUrl: 'https://external-api-approval.example/prefix/api/provider-broker/v1',
            protocols: ['openai_responses', 'openai_chat_completions', 'anthropic_messages'],
        },
    });
    await harness.selectHomes([serverId]);
    harness.answer(serverId, TEAM_GET_PATH, {
        body: teamSummaryFixture({ capabilities: teamCapabilitiesFixture({}) }),
    });
    harness.answer(serverId, CREDENTIAL_GET_PATH, {
        body: teamCredentialResourceFixture({ id: 'resource-1' }),
    });
    harness.answer(serverId, MEMBERS_LIST_PATH, {
        body: {
            items: [teamMembershipFixture({
                id: 'membership-1',
                accountId: 'account-ada',
                account: accountDisplayProfileFixture('Ada'),
            })],
            nextCursor: null,
        },
    });
    harness.answer(serverId, EXTERNAL_KEYS_LIST_PATH, { body: { keys: initialKeys } });
    harness.answer(serverId, ACCOUNT_SETTINGS_V2_PATH, {
        body: {
            content: { t: 'plain', v: {} },
            version: 1,
        },
    });
    return serverId;
}

async function chooseMember(
    screen: Awaited<ReturnType<typeof renderScreen>>,
    member: Readonly<{ id?: string; accountId?: string; name?: string }> = {},
): Promise<void> {
    await screen.pressByTestIdAsync('team-credential-external-assignee');
    const picker = shownModals.find((modal) => modal.chrome?.testID === 'team-credential-audience-picker:modal');
    if (!picker) throw new Error('external_key_assignee_picker_missing');
    await act(async () => {
        (picker.props?.onChoose as (principal: { kind: 'member'; id: string; accountId: string; name: string }) => void)({
            kind: 'member',
            id: member.id ?? 'membership-1',
            accountId: member.accountId ?? 'account-ada',
            name: member.name ?? 'Ada',
        });
    });
}

beforeEach(async () => {
    const { resetTeamsSnapshotsForTests } = await import('@/sync/store/teams/teamsSnapshots');
    const { resetTeamsDirectoryEngineForTests } = await import('@/sync/engine/teams/teamsDirectoryEngine');
    const { resetTeamActionClientForTests } = await import('@/sync/ops/teams/teamActionClient');
    resetTeamsSnapshotsForTests();
    resetTeamsDirectoryEngineForTests();
    resetTeamActionClientForTests();
    clipboardSet.mockReset();
    clipboardSet.mockResolvedValue(undefined);
    await harness.reset();
    await harness.selectHomes([]);
    clipboardSet.mockClear();
    modalConfirm.mockReset();
    modalConfirm.mockResolvedValue(true);
    routerReplace.mockReset();
    navigationState.dispatch.mockReset();
    navigationState.setOptions.mockReset();
    navigationState.preventRemove = false;
    navigationState.onPreventRemove = null;
    approvalArtifactState.value = { artifact: null, isLoading: false, error: null, invalidArtifact: false };
    approvalArtifactState.requested = [];
    approvalArtifactState.listeners.clear();
    shownModals.length = 0;
});

afterEach(() => standardCleanup());

describe('TeamCredentialExternalApiScreen', () => {
    it('discloses the Home readability, bearer authority, and incomplete terminal accounting before key creation', async () => {
        const serverId = await addManagedHome();

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-empty')).not.toBeNull());
        expect(screen.getTextContent()).toContain('teams.credentials.externalApi.homeDisclosure');
        expect(screen.getTextContent()).toContain('teams.credentials.externalApi.bearerDisclosure');
        expect(screen.getTextContent()).toContain('teams.credentials.externalApi.usageDisclosure');
    });

    it('keeps an initial key-list failure distinct from an empty snapshot and blocks creation until retry succeeds', async () => {
        const serverId = await addManagedHome();
        harness.answer(serverId, EXTERNAL_KEYS_LIST_PATH, { status: 503, body: { error: 'unavailable' } });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-retry')).not.toBeNull());
        expect(screen.findByTestId('team-credential-external-empty')).toBeNull();
        expect(screen.findHostByTestId('team-credential-external-assignee')?.props.disabled).toBe(true);
        expect(screen.findHostByTestId('team-credential-external-create')?.props.disabled).toBe(true);
        expect(harness.requestsFor(EXTERNAL_KEY_CREATE_PATH)).toHaveLength(0);

        harness.answer(serverId, EXTERNAL_KEYS_LIST_PATH, { body: { keys: [] } });
        await screen.pressByTestIdAsync('team-credential-external-retry');
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-empty')).not.toBeNull());
        act(() => screen.changeTextByTestId('team-credential-external-label', 'CI runner'));
        await chooseMember(screen);
        expect(screen.findHostByTestId('team-credential-external-create')?.props.disabled).not.toBe(true);
    });

    it.each([
        {
            name: 'missing deployment projection',
            availability: undefined,
            expected: 'teams.credentials.externalApi.unavailable',
        },
        {
            name: 'malformed deployment projection',
            availability: { available: true, baseUrl: 'not-a-url', protocols: [] },
            expected: 'teams.credentials.externalApi.unavailable',
        },
        {
            name: 'HTTP deployment projection',
            availability: {
                available: true,
                baseUrl: 'http://home.example.test/api/provider-broker/v1',
                protocols: ['openai_responses', 'openai_chat_completions', 'anthropic_messages'],
            },
            expected: 'teams.credentials.externalApi.unavailable',
        },
        {
            name: 'server-declared non-HTTPS deployment',
            availability: { available: false as const, reason: 'home_not_public_https' as const },
            expected: 'teams.credentials.externalApi.publicHttpsRequired',
        },
    ])('keeps External API visible but prevents key reads for $name', async ({ availability, expected }) => {
        const serverId = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://private-home.example',
            publicServerUrl: 'https://generic-profile-url.example',
            accountId: 'account-ada',
            teamsEnabled: true,
            credentialResourcesEnabled: true,
            credentialResourcesExternalApiEnabled: true,
            ...(availability ? { credentialResourcesExternalApiAvailability: availability } : {}),
        });
        await harness.selectHomes([serverId]);
        harness.answer(serverId, TEAM_GET_PATH, {
            body: teamSummaryFixture({ capabilities: teamCapabilitiesFixture({}) }),
        });
        harness.answer(serverId, CREDENTIAL_GET_PATH, {
            body: teamCredentialResourceFixture({ id: 'resource-1' }),
        });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-unavailable')).not.toBeNull());
        expect(screen.getTextContent()).toContain(expected);
        expect(screen.getTextContent()).not.toContain('generic-profile-url.example/api/provider-broker/v1');
        expect(harness.requestsFor(EXTERNAL_KEYS_LIST_PATH)).toHaveLength(0);
    });

    it('fails a direct route closed before disclosing deployment recovery to a viewer who cannot manage the resource', async () => {
        const serverId = await harness.addHome({
            name: 'Home A', serverUrl: 'https://private-home.example', accountId: 'account-ada',
            teamsEnabled: true, credentialResourcesEnabled: true,
            credentialResourcesExternalApiEnabled: true,
            credentialResourcesExternalApiAvailability: {
                available: false,
                reason: 'home_not_public_https',
            },
        });
        await harness.selectHomes([serverId]);
        harness.answer(serverId, TEAM_GET_PATH, {
            body: teamSummaryFixture({ capabilities: teamCapabilitiesFixture({}) }),
        });
        harness.answer(serverId, CREDENTIAL_GET_PATH, {
            body: teamCredentialResourceFixture({
                id: 'resource-1',
                capabilities: {
                    manageAudience: false, managePolicy: false, manageLimits: false,
                    updateBrokerPlacement: false, narrowDisclosure: false,
                    refreshDirectMaterial: false, disable: false, enable: false, delete: false,
                },
            }),
        });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-forbidden')).not.toBeNull());
        expect(screen.getTextContent()).not.toContain('teams.credentials.externalApi.publicHttpsRequired');
        expect(harness.requestsFor(EXTERNAL_KEYS_LIST_PATH)).toHaveLength(0);
    });

    it('creates with an expiry and reveals independently copyable Home configuration without losing an uncopied key', async () => {
        const serverId = await addManagedHome();
        harness.answer(serverId, EXTERNAL_KEY_CREATE_PATH, {
            body: { token: CREATED_TOKEN, key: { ...key(CREATED_KEY_ID, 'resource-1', 'CI runner'), expiresAt: '2026-10-07T10:00:00.000Z' } },
        });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-assignee')).not.toBeNull());
        act(() => screen.changeTextByTestId('team-credential-external-label', 'CI runner'));
        await chooseMember(screen);
        await screen.pressByTestIdAsync('team-credential-external-expiry:30d');
        await screen.pressByTestIdAsync('team-credential-external-create');

        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-value:token')).not.toBeNull());
        expect(screen.getTextContent()).toContain('https://external-api-approval.example/prefix/api/provider-broker/v1');
        expect(screen.getTextContent()).toContain(CREATED_TOKEN);
        expect(screen.getTextContent()).toContain('OPENAI_BASE_URL=https://external-api-approval.example/prefix/api/provider-broker/v1');
        expect(screen.getTextContent()).toContain('ANTHROPIC_BASE_URL=https://external-api-approval.example/prefix/api/provider-broker/v1');
        expect(harness.requestsFor(EXTERNAL_KEY_CREATE_PATH)[0]?.input).toMatchObject({
            teamMembershipId: 'membership-1', label: 'CI runner', expiresAt: expect.any(String),
        });

        modalConfirm.mockResolvedValueOnce(false);
        await screen.pressByTestIdAsync('team-credential-external-value:base-url');
        await screen.pressByTestIdAsync('team-credential-external-reveal-done');
        expect(screen.findByTestId('team-credential-external-value:token')).not.toBeNull();
        await screen.pressByTestIdAsync('team-credential-external-value:token');
        expect(clipboardSet).toHaveBeenLastCalledWith(CREATED_TOKEN);
        await screen.pressByTestIdAsync('team-credential-external-reveal-done');
        expect(screen.findByTestId('team-credential-external-value:token')).toBeNull();
        expect(screen.getTextContent()).toContain('teams.credentials.externalApi.assignLabel');
        expect(screen.getTextContent()).toContain('Ada');
    });

    it('uses one reveal-loss confirmation for native/browser navigation removal and keeps the bearer when canceled', async () => {
        const serverId = await addManagedHome();
        harness.answer(serverId, EXTERNAL_KEY_CREATE_PATH, {
            body: { token: CREATED_TOKEN, key: key(CREATED_KEY_ID, 'resource-1', 'CI runner') },
        });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-assignee')).not.toBeNull());
        act(() => screen.changeTextByTestId('team-credential-external-label', 'CI runner'));
        await chooseMember(screen);
        await screen.pressByTestIdAsync('team-credential-external-create');
        await vi.waitFor(() => {
            expect(screen.findByTestId('team-credential-external-value:token')).not.toBeNull();
            expect(navigationState.preventRemove).toBe(true);
        });
        expect(navigationState.setOptions).toHaveBeenCalledWith({ gestureEnabled: false });

        modalConfirm.mockResolvedValueOnce(false);
        await act(async () => {
            navigationState.onPreventRemove?.({ data: { action: { type: 'GO_BACK' } } });
            await Promise.resolve();
        });
        expect(navigationState.dispatch).not.toHaveBeenCalled();
        expect(screen.findByTestId('team-credential-external-value:token')).not.toBeNull();

        modalConfirm.mockResolvedValueOnce(true);
        await act(async () => {
            navigationState.onPreventRemove?.({ data: { action: { type: 'REPLACE', payload: { target: 'resource-2' } } } });
            await Promise.resolve();
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(navigationState.dispatch).toHaveBeenCalledWith({
            type: 'REPLACE',
            payload: { target: 'resource-2' },
        }));
    });

    it('restores the prior exact route when a mounted target replacement would discard an uncopied bearer', async () => {
        const serverId = await addManagedHome();
        harness.answer(serverId, EXTERNAL_KEY_CREATE_PATH, {
            body: { token: CREATED_TOKEN, key: key(CREATED_KEY_ID, 'resource-1', 'CI runner') },
        });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-assignee')).not.toBeNull());
        act(() => screen.changeTextByTestId('team-credential-external-label', 'CI runner'));
        await chooseMember(screen);
        await screen.pressByTestIdAsync('team-credential-external-create');
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-value:token')).not.toBeNull());

        modalConfirm.mockResolvedValueOnce(false);
        harness.answer(serverId, CREDENTIAL_GET_PATH, {
            body: teamCredentialResourceFixture({ id: 'resource-2' }),
        });
        await screen.update(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-2" />,
        );

        await vi.waitFor(() => expect(routerReplace).toHaveBeenCalledWith(
            `/settings/teams/${serverId}/team-1/credentials/resource-1/external-api`,
        ));
        expect(screen.findByTestId('team-credential-external-value:token')).not.toBeNull();
        expect(screen.getTextContent()).toContain(CREATED_TOKEN);
    });

    it('loads only the newly accepted resource after a mounted target replacement discards an uncopied bearer', async () => {
        const serverId = await addManagedHome();
        harness.answer(serverId, EXTERNAL_KEY_CREATE_PATH, {
            body: { token: CREATED_TOKEN, key: key(CREATED_KEY_ID, 'resource-1', 'CI runner') },
        });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-assignee')).not.toBeNull());
        act(() => screen.changeTextByTestId('team-credential-external-label', 'CI runner'));
        await chooseMember(screen);
        await screen.pressByTestIdAsync('team-credential-external-create');
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-value:token')).not.toBeNull());

        harness.answer(serverId, CREDENTIAL_GET_PATH, {
            body: teamCredentialResourceFixture({ id: 'resource-2' }),
        });
        harness.answer(serverId, EXTERNAL_KEYS_LIST_PATH, { body: { keys: [] } });
        const listRequestsBeforeReplacement = harness.requestsFor(EXTERNAL_KEYS_LIST_PATH).length;
        modalConfirm.mockResolvedValueOnce(true);
        await screen.update(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-2" />,
        );

        await vi.waitFor(() => expect(harness.requestsFor(EXTERNAL_KEYS_LIST_PATH)).toHaveLength(
            listRequestsBeforeReplacement + 1,
        ));
        expect(harness.requestsFor(EXTERNAL_KEYS_LIST_PATH).at(-1)?.input).toMatchObject({ resourceId: 'resource-2' });
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-empty')).not.toBeNull());
        expect(screen.findByTestId('team-credential-external-value:token')).toBeNull();
    });

    it('creates a replacement before optionally revoking the old key and preserves the old key on either failure', async () => {
        const oldKey = key('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'resource-1', 'Old runner');
        const serverId = await addManagedHome([oldKey]);
        harness.answer(serverId, EXTERNAL_KEY_CREATE_PATH, { status: 503, body: { error: 'unavailable' } });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId(`team-credential-external-key:${oldKey.keyId}`)).not.toBeNull());
        await screen.pressByTestIdAsync(`team-credential-external-replace:${oldKey.keyId}`);
        await screen.pressByTestIdAsync('team-credential-external-create');
        expect(screen.findByTestId(`team-credential-external-key:${oldKey.keyId}`)).not.toBeNull();
        expect(harness.requestsFor(EXTERNAL_KEY_REVOKE_PATH)).toHaveLength(0);

        harness.answer(serverId, EXTERNAL_KEY_CREATE_PATH, {
            body: { token: CREATED_TOKEN, key: key(CREATED_KEY_ID, 'resource-1', 'Old runner') },
        });
        await screen.pressByTestIdAsync('team-credential-external-create');
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-replace-revoke-old')).not.toBeNull());
        expect(screen.findByTestId(`team-credential-external-key:${oldKey.keyId}`)).not.toBeNull();

        harness.answer(serverId, EXTERNAL_KEY_REVOKE_PATH, { status: 503, body: { error: 'unavailable' } });
        await screen.pressByTestIdAsync('team-credential-external-replace-revoke-old');
        expect(screen.findByTestId(`team-credential-external-key:${oldKey.keyId}`)).not.toBeNull();

        harness.answer(serverId, EXTERNAL_KEY_REVOKE_PATH, { body: { keyId: oldKey.keyId, revoked: true } });
        await screen.pressByTestIdAsync('team-credential-external-replace-revoke-old');
        await vi.waitFor(() => expect(screen.findByTestId(`team-credential-external-key:${oldKey.keyId}`)).toBeNull());
    });

    it('shows which key a staged replacement targets and lets it be cleared before creating', async () => {
        const oldKey = key('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'resource-1', 'Old runner');
        const serverId = await addManagedHome([oldKey]);
        harness.answer(serverId, EXTERNAL_KEY_CREATE_PATH, {
            body: { token: CREATED_TOKEN, key: key(CREATED_KEY_ID, 'resource-1', 'Old runner') },
        });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId(`team-credential-external-key:${oldKey.keyId}`)).not.toBeNull());

        // Replace stages a target. Before this it was invisible state that silently
        // changed what the next Create offered to revoke.
        expect(screen.findByTestId('team-credential-external-replace-staged')).toBeNull();
        await screen.pressByTestIdAsync(`team-credential-external-replace:${oldKey.keyId}`);
        expect(screen.findByTestId('team-credential-external-replace-staged')).not.toBeNull();
        expect(screen.getTextContent()).toContain('Old runner');

        // Clearing it must actually unstage: the created key offers no revoke-old row.
        await screen.pressByTestIdAsync('team-credential-external-replace-staged');
        expect(screen.findByTestId('team-credential-external-replace-staged')).toBeNull();
        await screen.pressByTestIdAsync('team-credential-external-create');
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-reveal-done')).not.toBeNull());
        expect(screen.findByTestId('team-credential-external-replace-revoke-old')).toBeNull();
        expect(screen.findByTestId(`team-credential-external-key:${oldKey.keyId}`)).not.toBeNull();
    });

    it('settles an approved create with its exact one-time bearer without redispatching', async () => {
        const serverId = await addManagedHome();
        await harness.requireUiApproval(serverId, 'teams.credentials.externalKeys.create');

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-assignee')).not.toBeNull());
        act(() => screen.changeTextByTestId('team-credential-external-label', 'CI runner'));
        await chooseMember(screen);
        await screen.pressByTestIdAsync('team-credential-external-create');

        await vi.waitFor(() => expect(harness.requestsFor(ARTIFACT_CREATE_PATH)).toHaveLength(1));
        await vi.waitFor(() => expect(screen.findByTestId('team-approval')).not.toBeNull());
        expect(screen.findByTestId('team-credential-external-label')?.props.value).toBe('CI runner');
        expect(screen.findHostByTestId('team-credential-external-create')?.props.disabled).toBe(true);
        expect(harness.requestsFor(EXTERNAL_KEY_CREATE_PATH)).toHaveLength(0);

        await settleApproval('executed', {
            token: CREATED_TOKEN,
            key: key(CREATED_KEY_ID, 'resource-1', 'CI runner'),
        });
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-value:token')).not.toBeNull());
        expect(screen.findByTestId('team-approval')).toBeNull();
        expect(screen.findByTestId('team-credential-external-label')?.props.value).toBe('');
        await screen.pressByTestIdAsync('team-credential-external-value:token');
        expect(clipboardSet).toHaveBeenCalledWith(CREATED_TOKEN);
        expect(harness.requestsFor(EXTERNAL_KEY_CREATE_PATH)).toHaveLength(0);
    });

    it('releases a canceled create approval for retry while preserving the key draft', async () => {
        const serverId = await addManagedHome();
        await harness.requireUiApproval(serverId, 'teams.credentials.externalKeys.create');

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-assignee')).not.toBeNull());
        act(() => screen.changeTextByTestId('team-credential-external-label', 'CI runner'));
        await chooseMember(screen);
        await screen.pressByTestIdAsync('team-credential-external-create');
        await vi.waitFor(() => expect(harness.requestsFor(ARTIFACT_CREATE_PATH)).toHaveLength(1));
        await vi.waitFor(() => expect(screen.findByTestId('team-approval')).not.toBeNull());

        await settleApproval('canceled');
        await vi.waitFor(() => {
            expect(screen.findByTestId('team-approval')).toBeNull();
            expect(screen.findHostByTestId('team-credential-external-create')?.props.disabled).not.toBe(true);
        });
        expect(screen.findByTestId('team-credential-external-label')?.props.value).toBe('CI runner');
        expect(screen.findByTestId('team-credential-external-value:token')).toBeNull();
        expect(harness.requestsFor(EXTERNAL_KEY_CREATE_PATH)).toHaveLength(0);
    });

    it.each([
        {
            label: 'one key',
            actionId: 'teams.credentials.externalKeys.revoke' as const,
            expectedInput: { resourceId: 'resource-1', keyId: CREATED_KEY_ID },
            result: { keyId: CREATED_KEY_ID, revoked: true },
            pressId: `team-credential-external-revoke:${CREATED_KEY_ID}`,
            mutationPath: EXTERNAL_KEY_REVOKE_PATH,
        },
        {
            label: 'all keys',
            actionId: 'teams.credentials.externalKeys.revokeAll' as const,
            expectedInput: { resourceId: 'resource-1' },
            result: { resourceId: 'resource-1', revokedCount: 1 },
            pressId: 'team-credential-external-revoke-all',
            mutationPath: EXTERNAL_KEY_REVOKE_ALL_PATH,
        },
    ])('settles approved revocation of $label from the exact result without redispatching', async (scenario) => {
        const existing = key(CREATED_KEY_ID, 'resource-1', 'CI runner');
        const serverId = await addManagedHome([existing]);
        await harness.requireUiApproval(serverId, scenario.actionId);

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId(`team-credential-external-key:${CREATED_KEY_ID}`)).not.toBeNull());
        await screen.pressByTestIdAsync(scenario.pressId);
        await vi.waitFor(() => expect(harness.requestsFor(ARTIFACT_CREATE_PATH)).toHaveLength(1));
        await vi.waitFor(() => expect(screen.findByTestId('team-approval')).not.toBeNull());
        expect(screen.findHostByTestId(`team-credential-external-revoke:${CREATED_KEY_ID}`)?.props.disabled).toBe(true);
        expect(harness.requestsFor(scenario.mutationPath)).toHaveLength(0);

        // Execution committed at the Home before the approval Artifact settled.
        // The shared continuation refreshes projections as well as applying the
        // exact result, so the genuine list boundary must now describe that
        // committed state rather than reintroducing the revoked key.
        harness.answer(serverId, EXTERNAL_KEYS_LIST_PATH, { body: { keys: [] } });
        await settleApproval('executed', scenario.result);
        await vi.waitFor(() => expect(screen.findByTestId(`team-credential-external-key:${CREATED_KEY_ID}`)).toBeNull());
        expect(screen.findByTestId('team-approval')).toBeNull();
        expect(harness.requestsFor(scenario.mutationPath)).toHaveLength(0);
        expect(readOpenApprovalArtifact().request.actionArgs).toMatchObject(scenario.expectedInput);
    });

    it('settles an initial resource-list failure and retries before reading keys', async () => {
        const serverId = await harness.addHome({
            name: 'Home A', serverUrl: 'https://private-home-a.example', publicServerUrl: 'https://home-a.example', accountId: 'account-ada',
            teamsEnabled: true, credentialResourcesEnabled: true,
            credentialResourcesExternalApiEnabled: true,
            credentialResourcesExternalApiAvailability: {
                available: true,
                baseUrl: 'https://home-a.example/api/provider-broker/v1',
                protocols: ['openai_responses', 'openai_chat_completions', 'anthropic_messages'],
            },
        });
        await harness.selectHomes([serverId]);
        harness.answer(serverId, TEAM_GET_PATH, {
            body: teamSummaryFixture({ capabilities: teamCapabilitiesFixture({}) }),
        });
        harness.answer(serverId, CREDENTIAL_GET_PATH, { status: 503, body: { error: 'unavailable' } });
        harness.answer(serverId, EXTERNAL_KEYS_LIST_PATH, { body: { keys: [] } });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => {
            expect(screen.findByTestId('team-credential-external-resource-retry')).not.toBeNull();
        });
        expect(harness.requestsFor(EXTERNAL_KEYS_LIST_PATH)).toHaveLength(0);

        harness.answer(serverId, CREDENTIAL_GET_PATH, {
            body: teamCredentialResourceFixture({ id: 'resource-1' }),
        });
        await screen.pressByTestIdAsync('team-credential-external-resource-retry');
        await vi.waitFor(() => expect(screen.findByTestId('team-credential-external-empty')).not.toBeNull());
    });

    it('does not let an older resource response overwrite a newly selected target', async () => {
        const serverId = await harness.addHome({
            name: 'Home A', serverUrl: 'https://private-home-a.example', publicServerUrl: 'https://home-a.example', accountId: 'account-ada',
            teamsEnabled: true, credentialResourcesEnabled: true,
            credentialResourcesExternalApiEnabled: true,
            credentialResourcesExternalApiAvailability: {
                available: true,
                baseUrl: 'https://home-a.example/api/provider-broker/v1',
                protocols: ['openai_responses', 'openai_chat_completions', 'anthropic_messages'],
            },
        });
        await harness.selectHomes([serverId]);
        harness.answer(serverId, TEAM_GET_PATH, {
            body: teamSummaryFixture({ capabilities: teamCapabilitiesFixture({}) }),
        });
        harness.answer(serverId, CREDENTIAL_GET_PATH, {
            body: teamCredentialResourceFixture({ id: 'resource-1', displayName: 'First' }),
        });

        let releaseFirst!: () => void;
        const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
        harness.answer(serverId, EXTERNAL_KEYS_LIST_PATH, {
            respondAfter: firstPending,
            body: { keys: [key('550e8400-e29b-41d4-a716-446655440000', 'resource-1', 'Old target')] },
        });

        const { TeamCredentialExternalApiScreen } = await import('./TeamCredentialExternalApiScreen');
        const screen = await renderScreen(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-1" />,
        );
        await vi.waitFor(() => expect(harness.requestsFor(EXTERNAL_KEYS_LIST_PATH)).toHaveLength(1));

        harness.answer(serverId, EXTERNAL_KEYS_LIST_PATH, {
            body: { keys: [key('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'resource-2', 'Current target')] },
        });
        harness.answer(serverId, CREDENTIAL_GET_PATH, {
            body: teamCredentialResourceFixture({ id: 'resource-2', displayName: 'Second' }),
        });
        await screen.update(
            <TeamCredentialExternalApiScreen serverId={serverId} teamId="team-1" resourceId="resource-2" />,
        );
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain(
                'team-credential-external-key:6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            );
        });

        releaseFirst();
        await vi.waitFor(() => {
            expect(screen.getTextContent()).toContain('Current target');
            expect(screen.getTextContent()).not.toContain('Old target');
        });
    });
});
