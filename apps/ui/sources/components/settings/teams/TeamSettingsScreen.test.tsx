import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ARTIFACT_PLAIN_DATA_KEY_MARKER,
    encodePlainArtifactStoredContent,
} from '@happier-dev/protocol';

import {
    collectRenderedTestIds,
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
    renderScreen,
    standardCleanup,
    teamCapabilitiesFixture,
    teamPolicyFixture,
    teamSummaryFixture,
} from '@/dev/testkit';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';

vi.mock('@/sync/api/capabilities/accountStoredContentCompatibility', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/capabilities/accountStoredContentCompatibility')>(),
    requireCurrentAccountStoredContentServerCompatibility: vi.fn(async () => undefined),
}));

import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerBack = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());
const pickImages = vi.hoisted(() => vi.fn());

vi.mock('@/utils/files/nativePickImages', () => ({
    nativePickImages: pickImages,
}));

vi.mock('@/platform/randomUUID', () => ({
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
}));

// App-bundled plugin bytes are a generated build boundary unrelated to this
// source-level Team settings contract. The synchronized target intentionally
// has no generated inventory, so keep that boundary inert while the real
// Action policy, approval continuation and Team screen paths execute below it.
vi.mock('@/sync/domains/plugins/availability/generatedBundledPluginUiArtifacts', () => ({
    BUNDLED_PLUGIN_UI_APP_ARTIFACTS: Object.freeze([]),
}));
vi.mock('@/sync/domains/plugins/availability/bundledAppExactArtifactSource', () => ({
    createBundledPluginUiAppExactArtifactSource: () => Object.freeze({
        kind: 'appExact' as const,
        fetch: async () => null,
    }),
    createBundledPluginUiAppExactArtifactSourceFromInventory: () => Object.freeze({
        kind: 'appExact' as const,
        fetch: async () => null,
    }),
}));

// The logo picker reads picked bytes through the platform file API, which has no
// implementation in this runtime. It is a genuine process boundary, and the
// screen's own decisions — capability gating, validation, the Team-owned media
// mutation — all stay real below it.
vi.mock('expo-file-system', () => ({
    File: class {
        constructor(readonly uri: string) {}
        async bytes(): Promise<Uint8Array> {
            return new Uint8Array();
        }
    },
}));

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: routerPush, back: routerBack }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ confirmResult: true }).module;
    },
});

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const TEAM_GET_PATH = '/v1/teams/get';
const TEAM_UPDATE_PATH = '/v1/teams/update';
const TEAM_POLICY_PATH = '/v1/teams/policy/set';
const TEAM_ARCHIVE_PATH = '/v1/teams/archive';
const TEAM_RESTORE_PATH = '/v1/teams/restore';
const TEAM_LOGO_SET_PATH = '/v1/teams/logo/set';
const TEAM_LOGO_REMOVE_PATH = '/v1/teams/logo/remove';
const ACCOUNT_SETTINGS_V2_PATH = '/v2/account/settings';
const ARTIFACT_CREATE_PATH = '/v1/artifacts';
const APPROVAL_ARTIFACT_ID = '00000000-0000-4000-8000-000000000001';

function approvalArtifactResponse(approvalStatus: 'canceled' | 'executed') {
    const request = {
        v: 1 as const,
        status: approvalStatus,
        createdAtMs: 1,
        updatedAtMs: 2,
        createdBy: { surface: 'system' as const },
        requestedSurface: 'ui',
        actionId: 'teams.update' as const,
        actionArgs: { teamId: 'team-1', name: 'Approval rename' },
        summary: 'Update Team',
        ...(approvalStatus === 'executed'
            ? {
                decision: { kind: 'approve' as const, decidedAtMs: 2 },
                execution: { executedAtMs: 2, ok: true },
            }
            : {}),
    };
    return {
        id: APPROVAL_ARTIFACT_ID,
        header: encodePlainArtifactStoredContent({
            v: 1,
            kind: 'approval_request.v1',
            title: 'Update Team',
            actionId: 'teams.update',
            approvalStatus,
        }),
        body: encodePlainArtifactStoredContent({ body: JSON.stringify(request) }),
        dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
        headerVersion: 2,
        bodyVersion: 2,
        seq: 2,
        createdAt: 1,
        updatedAt: 2,
    };
}

async function renderSettings(serverId: string) {
    const { TeamSettingsScreen } = await import('./TeamSettingsScreen');
    return renderScreen(<TeamSettingsScreen serverId={serverId} teamId="team-1" />);
}

async function addHomeWithTeam(
    team: ReturnType<typeof teamSummaryFixture>,
    options: Readonly<{ waiveDangerousUi?: boolean; homeKey?: string }> = {},
): Promise<string> {
    const homeKey = options.homeKey ?? 'a';
    const serverId = await harness.addHome({
        name: 'Home A',
        serverUrl: `https://home-${homeKey}.example`,
        accountId: homeKey === 'a' ? 'account-ada' : `account-${homeKey}`,
        teamsEnabled: true,
    });
    await harness.selectHomes([serverId]);
    harness.answer(serverId, TEAM_GET_PATH, { body: team });
    // Default UI + present-user dispatches rely on the shared policy's normal
    // surface-confirmation behavior. The opt-out branch models a user who has
    // explicitly required another approval on the UI surface.
    harness.answer(serverId, ACCOUNT_SETTINGS_V2_PATH, {
        body: {
            content: {
                t: 'plain',
                v: {
                    actionsSettingsV1: options.waiveDangerousUi !== false
                        ? { v: 1, actions: {} }
                        : {
                            v: 1,
                            actions: {
                                'teams.policy.set': { approvalRequiredSurfaces: ['ui'] },
                                'teams.update': { approvalRequiredSurfaces: ['ui'] },
                                'teams.logo.set': { approvalRequiredSurfaces: ['ui'] },
                                'teams.logo.remove': { approvalRequiredSurfaces: ['ui'] },
                                'teams.archive': { approvalRequiredSurfaces: ['ui'] },
                                'teams.restore': { approvalRequiredSurfaces: ['ui'] },
                            },
                        },
                },
            },
            version: 1,
        },
    });
    return serverId;
}

async function waitForTestId(
    screen: Awaited<ReturnType<typeof renderSettings>>,
    testID: string,
): Promise<void> {
    await vi.waitFor(() => {
        expect(collectRenderedTestIds(screen.tree.toJSON())).toContain(testID);
    });
}

beforeEach(async () => {
    const { resetTeamsSnapshotsForTests } = await import('@/sync/store/teams/teamsSnapshots');
    const { resetTeamsDirectoryEngineForTests } = await import('@/sync/engine/teams/teamsDirectoryEngine');
    const { resetTeamActionClientForTests } = await import('@/sync/ops/teams/teamActionClient');
    resetTeamsSnapshotsForTests();
    resetTeamsDirectoryEngineForTests();
    resetTeamActionClientForTests();
    resetServerFeaturesClientForTests();
    await harness.reset();
    await harness.selectHomes([]);
    routerBack.mockReset();
    pickImages.mockReset();
});

afterEach(() => {
    standardCleanup();
});

describe('TeamSettingsScreen', () => {
    it('renames the Team through its own Home and keeps the edit until it lands', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team);
        harness.answer(serverId, TEAM_UPDATE_PATH, { body: { ...team, name: 'Platform Core' } });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-name');
        expect(screen.getTextContent()).toContain('common.save');
        // The edit has to be committed before the save reads it; without this
        // the submission carries the name the field started with.
        act(() => screen.changeTextByTestId('team-settings-name', 'Platform Core'));
        await screen.pressByTestIdAsync('team-settings-save');

        await vi.waitFor(() => {
            expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(1);
        });
        const update = harness.requestsFor(TEAM_UPDATE_PATH)[0];
        expect(update?.serverId).toBe(serverId);
        expect(update?.input).toMatchObject({ teamId: 'team-1', name: 'Platform Core' });
    });

    it('preserves a dirty identity draft across refresh and requires deliberate conflict acceptance', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team);
        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-name');

        act(() => {
            screen.changeTextByTestId('team-settings-name', 'Pending rename');
            screen.changeTextByTestId('team-settings-description', 'Pending description');
        });

        const { applyTeamProjection } = await import('@/sync/store/teams/teamsSnapshots');
        act(() => applyTeamProjection({
            scope: { serverId, accountId: 'account-ada' },
            address: { serverId, teamId: 'team-1' },
            team: { ...team, name: 'Current server name', description: 'Current server description' },
            observedAt: Date.now(),
        }));

        await waitForTestId(screen, 'team-settings-identity-conflict');
        expect(screen.findByTestId('team-settings-name')?.props.value).toBe('Pending rename');
        expect(screen.findByTestId('team-settings-description')?.props.value).toBe('Pending description');
        expect(screen.findByTestId('team-settings-save')?.props.disabled).toBe(true);

        await screen.pressByTestIdAsync('team-settings-identity-conflict');
        expect(screen.findByTestId('team-settings-name')?.props.value).toBe('Pending rename');
        expect(screen.findByTestId('team-settings-save')?.props.disabled).toBe(false);

        await screen.pressByTestIdAsync('team-settings-cancel');
        expect(screen.findByTestId('team-settings-name')?.props.value).toBe('Current server name');
        expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(0);
    });

    it('closes the same-frame duplicate save window before the busy state renders', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team);
        let releaseResponse = (): void => {};
        const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
        harness.answer(serverId, TEAM_UPDATE_PATH, { body: { ...team, name: 'Platform Core' }, respondAfter: responseGate });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-name');
        act(() => screen.changeTextByTestId('team-settings-name', 'Platform Core'));

        act(() => {
            screen.pressByTestId('team-settings-save');
            screen.pressByTestId('team-settings-save');
        });
        await vi.waitFor(() => expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(1));

        act(releaseResponse);
    });

    it('does not describe an issued identity mutation with a lost response as definitely unchanged', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team);
        let rejectResponse = (_cause: Error): void => {};
        const responseGate = new Promise<void>((_resolve, reject) => {
            rejectResponse = reject;
        });
        harness.answer(serverId, TEAM_UPDATE_PATH, {
            body: team,
            respondAfter: responseGate,
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-name');
        act(() => screen.changeTextByTestId('team-settings-name', 'Maybe renamed'));
        act(() => screen.pressByTestId('team-settings-save'));
        await vi.waitFor(() => expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(1));
        act(() => rejectResponse(new Error('response_lost')));

        await waitForTestId(screen, 'team-settings-identity-error');
        expect(screen.getTextContent()).toContain('teams.errors.outcomeUnknown');
        expect(screen.findByTestId('team-settings-identity-error')?.props.accessibilityLiveRegion)
            .toBe('assertive');
        expect(screen.findByTestId('team-settings-name')?.props.value).toBe('Maybe renamed');
    });

    it('renders only the controls the Home says this viewer has', async () => {
        const serverId = await addHomeWithTeam(teamSummaryFixture({
            // A Team owner by role, but the Home has withdrawn everything except
            // policy: a control rendered from the role would appear here.
            viewerRole: 'owner',
            capabilities: teamCapabilitiesFixture({ managePolicy: true }),
        }));

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-session-creation:team_required');

        const ids = collectRenderedTestIds(screen.tree.toJSON());
        expect(ids).not.toContain('team-settings-name');
        expect(ids).not.toContain('team-settings-logo-set');
        expect(ids).not.toContain('team-settings-archive');
    });

    it('changes one policy field at a time against the Team it is showing', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ managePolicy: true }),
        });
        const serverId = await addHomeWithTeam(team);
        harness.answer(serverId, TEAM_POLICY_PATH, {
            body: {
                ...team,
                policy: teamPolicyFixture({ externalSharingPolicy: 'disabled' }),
            },
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-external-sharing:disabled');
        await screen.pressByTestIdAsync('team-settings-external-sharing:disabled');

        await vi.waitFor(() => {
            expect(harness.requestsFor(TEAM_POLICY_PATH)).toHaveLength(1);
        });
        const request = harness.requestsFor(TEAM_POLICY_PATH)[0]?.input as Record<string, unknown>;
        expect(request).toMatchObject({ teamId: 'team-1', externalSharingPolicy: 'disabled' });
        // A history-default change must not ride along: it would look like a
        // rewrite of existing membership horizons.
        expect(request).not.toHaveProperty('defaultSessionHistoryAccess');
    });

    it('closes the same-frame duplicate policy window before the busy state renders', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ managePolicy: true }),
        });
        const serverId = await addHomeWithTeam(team);
        let releaseResponse = (): void => {};
        const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
        harness.answer(serverId, TEAM_POLICY_PATH, {
            body: { ...team, policy: teamPolicyFixture({ externalSharingPolicy: 'disabled' }) },
            respondAfter: responseGate,
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-external-sharing:disabled');
        act(() => {
            screen.pressByTestId('team-settings-external-sharing:disabled');
            screen.pressByTestId('team-settings-history-default:all_existing');
        });
        await vi.waitFor(() => expect(harness.requestsFor(TEAM_POLICY_PATH)).toHaveLength(1));

        act(releaseResponse);
    });

    it('exposes each policy choice set as a labeled radio group with checked state', async () => {
        const serverId = await addHomeWithTeam(teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ managePolicy: true }),
        }));

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-session-creation:private_default');

        const selectedChoices = [
            ['team-settings-session-creation:team_default', 'teams.settings.sessionDefaultsSection'],
            ['team-settings-external-sharing:allowed', 'teams.settings.externalSharingSection'],
            ['team-settings-history-default:from_membership', 'teams.settings.historyDefaultSection'],
        ] as const;

        for (const [testID, groupLabel] of selectedChoices) {
            const selected = screen.findByTestId(testID);
            expect([selected?.props.accessibilityRole, selected?.props.role]).toContain('radio');
            expect(selected?.props.accessibilityState).toMatchObject({ checked: true });

            let ancestor = selected?.parent ?? null;
            while (ancestor
                && ancestor.props.accessibilityRole !== 'radiogroup'
                && ancestor.props.role !== 'radiogroup') {
                ancestor = ancestor.parent;
            }
            expect(ancestor).not.toBeNull();
            expect(ancestor?.props.accessibilityLabel ?? ancestor?.props['aria-label']).toBe(groupLabel);
        }
    });

    it('previews a picked logo and uploads only after explicit confirmation', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team);
        const bytes = new Uint8Array([137, 80, 78, 71]);
        pickImages.mockResolvedValue([{
            kind: 'web',
            file: {
                type: 'image/png',
                arrayBuffer: async () => bytes.buffer,
            },
        }]);
        harness.answer(serverId, TEAM_LOGO_SET_PATH, { status: 503, body: { error: 'unavailable' } });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-logo-set');
        await screen.pressByTestIdAsync('team-settings-logo-set');

        await waitForTestId(screen, 'team-settings-logo-use');
        expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toHaveLength(0);
        expect(JSON.stringify(screen.tree.toJSON())).toContain('data:image/png;base64,');

        await screen.pressByTestIdAsync('team-settings-logo-cancel');
        expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toHaveLength(0);
        await screen.pressByTestIdAsync('team-settings-logo-set');
        await waitForTestId(screen, 'team-settings-logo-use');

        await screen.pressByTestIdAsync('team-settings-logo-use');
        await vi.waitFor(() => expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toHaveLength(1));
        expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('team-settings-logo-use');
        expect(JSON.stringify(screen.tree.toJSON())).toContain('data:image/png;base64,');

        harness.answer(serverId, TEAM_LOGO_SET_PATH, {
            body: {
                ...team,
                logo: {
                    path: 'public/teams/team-1/logo/team-logo.webp',
                    url: 'https://home-a.example/team-logo.webp',
                    width: 512,
                    height: 512,
                    thumbhash: 'logo',
                },
            },
        });
        await screen.pressByTestIdAsync('team-settings-logo-use');
        await vi.waitFor(() => expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toHaveLength(2));
        expect(harness.requestsFor(TEAM_LOGO_SET_PATH)[0]?.input).toMatchObject({
            teamId: 'team-1',
            image: { mimeType: 'image/png' },
        });
    });

    it('starts only one confirmed logo upload when activated twice before busy renders', async () => {
        let releaseUpload = (): void => {};
        const respondAfter = new Promise<void>((resolve) => { releaseUpload = resolve; });
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team, { homeKey: 'logo-set-default-policy' });
        pickImages.mockResolvedValue([{
            kind: 'web',
            file: {
                type: 'image/png',
                arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
            },
        }]);
        harness.answer(serverId, TEAM_LOGO_SET_PATH, {
            body: {
                ...team,
                logo: {
                    path: 'public/teams/team-1/logo/team-logo.webp',
                    url: 'https://home-a.example/team-logo.webp',
                    width: 512,
                    height: 512,
                    thumbhash: 'logo',
                },
            },
            respondAfter,
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-logo-set');
        await screen.pressByTestIdAsync('team-settings-logo-set');
        await waitForTestId(screen, 'team-settings-logo-use');
        act(() => {
            screen.pressByTestId('team-settings-logo-use');
            screen.pressByTestId('team-settings-logo-use');
        });

        await vi.waitFor(() => expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toHaveLength(1));
        expect(harness.requestsFor(ARTIFACT_CREATE_PATH)).toHaveLength(0);
        await act(async () => releaseUpload());
    });

    it('starts only one confirmed logo removal when activated twice', async () => {
        let releaseRemoval = (): void => {};
        const respondAfter = new Promise<void>((resolve) => { releaseRemoval = resolve; });
        const team = teamSummaryFixture({
            logo: {
                path: 'public/teams/team-1/logo/team-logo.webp',
                url: 'https://home-a.example/team-logo.webp',
                width: 512,
                height: 512,
                thumbhash: 'logo',
            },
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team, { homeKey: 'logo-remove-default-policy' });
        harness.answer(serverId, TEAM_LOGO_REMOVE_PATH, {
            body: { ...team, logo: null },
            respondAfter,
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-logo-remove');
        act(() => {
            screen.pressByTestId('team-settings-logo-remove');
            screen.pressByTestId('team-settings-logo-remove');
        });

        await vi.waitFor(() => expect(harness.requestsFor(TEAM_LOGO_REMOVE_PATH)).toHaveLength(1));
        expect(harness.requestsFor(ARTIFACT_CREATE_PATH)).toHaveLength(0);
        await act(async () => releaseRemoval());
    });

    it('surfaces a required Team approval instead of rejecting the UI action', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ managePolicy: true, archiveTeam: true }),
        });
        const serverId = await addHomeWithTeam(team, {
            waiveDangerousUi: false,
            // This assertion depends on the fetched Account settings. A unique
            // scope prevents a previously focused test Account from supplying
            // an intentionally different live settings snapshot.
            homeKey: 'policy-approval',
        });
        harness.answer(serverId, ARTIFACT_CREATE_PATH, {
            body: {
                id: 'artifact-team-policy',
                header: '',
                body: '',
                dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
            },
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-external-sharing:disabled');
        await screen.pressByTestIdAsync('team-settings-external-sharing:disabled');

        await waitForTestId(screen, 'team-approval');
        expect(harness.requestsFor(TEAM_POLICY_PATH)).toHaveLength(0);
        expect(screen.findByTestId('team-settings-history-default:from_membership')?.props.disabled).toBe(true);
        expect(screen.findByTestId('team-settings-archive')?.props.disabled).toBe(true);
    });

    it('surfaces a required approval for an identity save without sending the mutation twice', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team, {
            waiveDangerousUi: false,
            homeKey: 'identity-approval',
        });
        harness.answer(serverId, ARTIFACT_CREATE_PATH, {
            body: {
                id: 'artifact-team-update',
                header: '',
                body: '',
                dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
            },
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-name');
        act(() => screen.changeTextByTestId('team-settings-name', 'Approval rename'));
        await screen.pressByTestIdAsync('team-settings-save');

        await vi.waitFor(() => {
            expect(harness.requests.map((request) => request.path)).toContain(ARTIFACT_CREATE_PATH);
        });
        await waitForTestId(screen, 'team-approval');
        expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(0);
        expect(screen.findByTestId('team-settings-save')?.props.disabled).toBe(true);
    });

    it('clears a canceled identity approval so the user can retry without redispatching it', async () => {
        let releaseArtifact!: () => void;
        const artifactReady = new Promise<void>((resolve) => { releaseArtifact = resolve; });
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team, {
            waiveDangerousUi: false,
            homeKey: 'identity-approval-canceled',
        });
        harness.answer(serverId, ARTIFACT_CREATE_PATH, {
            body: {
                id: APPROVAL_ARTIFACT_ID,
                header: '',
                body: '',
                dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
            },
        });
        harness.answer(serverId, `/v1/artifacts/${APPROVAL_ARTIFACT_ID}`, {
            body: approvalArtifactResponse('canceled'),
            respondAfter: artifactReady,
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-name');
        act(() => screen.changeTextByTestId('team-settings-name', 'Approval rename'));
        await screen.pressByTestIdAsync('team-settings-save');

        await waitForTestId(screen, 'team-approval');
        expect(screen.findByTestId('team-settings-save')?.props.disabled).toBe(true);
        expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(0);
        await act(async () => releaseArtifact());

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('team-approval');
            expect(screen.findByTestId('team-settings-save')?.props.disabled).not.toBe(true);
        });
        expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(0);
    });

    it('refreshes the Team after an approved identity replay executes without redispatching the mutation', async () => {
        let releaseArtifact!: () => void;
        const artifactReady = new Promise<void>((resolve) => { releaseArtifact = resolve; });
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        const serverId = await addHomeWithTeam(team, {
            waiveDangerousUi: false,
            homeKey: 'identity-approval-executed',
        });
        harness.answer(serverId, ARTIFACT_CREATE_PATH, {
            body: {
                id: APPROVAL_ARTIFACT_ID,
                header: '',
                body: '',
                dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
            },
        });
        harness.answer(serverId, `/v1/artifacts/${APPROVAL_ARTIFACT_ID}`, {
            body: approvalArtifactResponse('executed'),
            respondAfter: artifactReady,
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-name');
        const teamReadsBeforeApproval = harness.requestsFor(TEAM_GET_PATH).length;
        act(() => screen.changeTextByTestId('team-settings-name', 'Approval rename'));
        await screen.pressByTestIdAsync('team-settings-save');

        await waitForTestId(screen, 'team-approval');
        expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(0);
        await act(async () => releaseArtifact());

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('team-approval');
            expect(harness.requestsFor(TEAM_GET_PATH).length).toBeGreaterThan(teamReadsBeforeApproval);
        });
        expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(0);
    });

    it('leaves the Team after archiving it and offers restore from the archived Team', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true, archiveTeam: true }),
        });
        const serverId = await addHomeWithTeam(team, { homeKey: 'archive-default-policy' });
        harness.answer(serverId, TEAM_ARCHIVE_PATH, {
            body: { ...team, archivedAt: 1_700_000_000_000 },
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-archive');
        // The row opens a confirmation; the final confirm button owns the
        // destructive emphasis.
        const archiveRow = screen.findAll((node) => (
            node.props.testID === 'team-settings-archive'
            && node.props.title === 'teams.archive.action(name=Platform)'
        ))[0];
        expect(archiveRow).toBeDefined();
        expect(archiveRow?.props.destructive).not.toBe(true);
        act(() => {
            screen.pressByTestId('team-settings-archive');
            screen.pressByTestId('team-settings-archive');
        });

        await vi.waitFor(() => {
            expect(harness.requestsFor(TEAM_ARCHIVE_PATH)).toHaveLength(1);
        });
        // The shared default recognizes UI + present-user dispatch, so the
        // modal-confirmed action reaches the Home once without an Artifact.
        expect(harness.requestsFor(ARTIFACT_CREATE_PATH)).toHaveLength(0);
        expect(routerBack).toHaveBeenCalled();
    });

    it('honors an explicit required UI approval after archive confirmation', async () => {
        const team = teamSummaryFixture({
            capabilities: teamCapabilitiesFixture({ manageSettings: true, archiveTeam: true }),
        });
        const serverId = await addHomeWithTeam(team, {
            waiveDangerousUi: false,
            homeKey: 'archive-explicit-approval',
        });
        harness.answer(serverId, ARTIFACT_CREATE_PATH, {
            body: {
                id: 'artifact-team-archive',
                header: '',
                body: '',
                dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
            },
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-archive');
        await screen.pressByTestIdAsync('team-settings-archive');

        await waitForTestId(screen, 'team-approval');
        expect(harness.requestsFor(ARTIFACT_CREATE_PATH)).toHaveLength(1);
        expect(harness.requestsFor(TEAM_ARCHIVE_PATH)).toHaveLength(0);
        expect(routerBack).not.toHaveBeenCalled();
    });

    it('keeps restore reachable but disables it while its approval is unresolved', async () => {
        const team = teamSummaryFixture({
            archivedAt: 1_700_000_000_000,
            capabilities: teamCapabilitiesFixture({ restoreTeam: true }),
        });
        const serverId = await addHomeWithTeam(team, {
            waiveDangerousUi: false,
            homeKey: 'restore-explicit-approval',
        });
        harness.answer(serverId, ARTIFACT_CREATE_PATH, {
            body: {
                id: 'artifact-team-restore',
                header: '',
                body: '',
                dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
            },
        });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-settings-restore');
        await screen.pressByTestIdAsync('team-settings-restore');

        await waitForTestId(screen, 'team-approval');
        expect(harness.requestsFor(TEAM_RESTORE_PATH)).toHaveLength(0);
        expect(screen.findByTestId('team-settings-restore')).not.toBeNull();
        expect(screen.findByTestId('team-settings-restore')?.props.disabled).toBe(true);
    });

    it('keeps an archived Team read-only while restore stays reachable', async () => {
        const team = teamSummaryFixture({
            archivedAt: 1_700_000_000_000,
            capabilities: teamCapabilitiesFixture({
                manageSettings: true,
                managePolicy: true,
                archiveTeam: true,
                restoreTeam: true,
            }),
        });
        const serverId = await addHomeWithTeam(team, { homeKey: 'restore-default-policy' });
        harness.answer(serverId, TEAM_RESTORE_PATH, { body: { ...team, archivedAt: null } });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-archived');

        const ids = collectRenderedTestIds(screen.tree.toJSON());
        expect(ids).toContain('team-settings-restore');
        expect(ids).not.toContain('team-settings-archive');

        await screen.pressByTestIdAsync('team-settings-restore');
        await vi.waitFor(() => {
            expect(harness.requestsFor(TEAM_RESTORE_PATH)).toHaveLength(1);
        });
        expect(harness.requestsFor(ARTIFACT_CREATE_PATH)).toHaveLength(0);
        // Restore is legitimate *because* the Team is archived, so it is not
        // gated on the ordinary-write rule that archiving withdraws.
        expect(harness.requestsFor(TEAM_UPDATE_PATH)).toHaveLength(0);
    });

    it('routes a Team-authentication refusal to the exact-Home Team sign-in instead of a dead end', async () => {
        const serverId = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'account-ada',
            teamsEnabled: true,
        });
        await harness.selectHomes([serverId]);
        harness.answer(serverId, TEAM_GET_PATH, { status: 403, body: { error: 'team_authentication_required' } });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-authentication-required');
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('team-unavailable');

        routerPush.mockClear();
        await screen.pressByTestIdAsync('team-sign-in');
        // The canonical explicit-Home Team entry, addressed by this route's own
        // Home rather than by whichever Home is focused.
        expect(routerPush).toHaveBeenCalledWith(`/teams/team-1/sign-in?serverId=${encodeURIComponent(serverId)}`);
    });

    it('keeps an ordinary permission refusal a settled denial without a sign-in offer', async () => {
        const serverId = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'account-ada',
            teamsEnabled: true,
        });
        await harness.selectHomes([serverId]);
        harness.answer(serverId, TEAM_GET_PATH, { status: 403, body: { error: 'team_forbidden' } });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-unavailable');
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('team-sign-in');
    });

    it('explains an unreachable Home instead of showing an empty Team', async () => {
        const serverId = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'account-ada',
            teamsEnabled: true,
        });
        await harness.selectHomes([serverId]);
        harness.answer(serverId, TEAM_GET_PATH, { status: 503, body: { error: 'unavailable' } });

        const screen = await renderSettings(serverId);
        await waitForTestId(screen, 'team-unavailable');

        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('team-settings-name');
        expect(screen.findByTestId('team-unavailable')?.props.accessibilityRole).toBe('alert');
        expect(screen.findByTestId('team-unavailable')?.props.accessibilityLiveRegion).toBe('assertive');
    });
});
