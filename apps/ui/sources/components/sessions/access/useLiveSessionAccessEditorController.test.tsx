import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import tweetnacl from 'tweetnacl';
import {
    encodeSessionDataKeyEnvelopeCursorV1,
    signAccountContentKeyBindingV1,
    tryWriteServerEnabledBitInPlace,
} from '@happier-dev/protocol';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { encodeBase64 } from '@/encryption/base64';
import { encodeHex } from '@/encryption/hex';
import { primeServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { createAccountSettingsScope } from '@/sync/domains/settings/scope/accountSettingsScope';
import { settingsParse } from '@/sync/domains/settings/settings';
import { storage } from '@/sync/domains/state/storage';
import { encryptDataKeyForRecipientV0 } from '@/sync/encryption/directShareEncryption';
import { setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { publishHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';
import { runTeamAction } from '@/sync/ops/teams/teamActionClient';

import { useLiveSessionAccessEditorController } from './useLiveSessionAccessEditorController';
import type { SessionAccessEditorController } from './sessionAccessEditorTypes';

/** The manager's real content key pair; persisted credentials carry its secret as `machineKey`. */
const MANAGER = vi.hoisted(() => ({ serverId: '', accountId: 'manager', keys: null as null | { publicKey: Uint8Array; secretKey: Uint8Array } }));
const TEAM_DIRECTORY = vi.hoisted(() => ({ items: [] as Array<{
    id: string;
    name: string;
    policy: { sessionCreationPolicy: 'private_default' | 'team_default' | 'team_required'; externalSharingPolicy: 'allowed' | 'team_admins_only' | 'disabled' };
}>, failed: false }));

// Persistent credentials and HTTP are the replaced boundaries. Access projection, the
// grant client, the recipient-key owner and its real sealing stay live below them.
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    const base64 = await import('@/encryption/base64');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            getCredentialsForServerUrl: async (_url, options) => options?.serverId !== MANAGER.serverId ? null : {
                token: `e30.${Buffer.from(JSON.stringify({ sub: MANAGER.accountId })).toString('base64url')}.signature`,
                secret: 'test-secret',
                ...(MANAGER.keys ? {
                    encryption: {
                        publicKey: base64.encodeBase64(MANAGER.keys.publicKey, 'base64'),
                        machineKey: base64.encodeBase64(MANAGER.keys.secretKey, 'base64'),
                    },
                } : {}),
            },
        },
    });
});
vi.mock('@/sync/ops/teams/teamActionClient', () => ({
    runTeamAction: vi.fn(async () => TEAM_DIRECTORY.failed
        ? { kind: 'failed', failure: { kind: 'unreachable', retryable: true, code: null } }
        : { kind: 'succeeded', value: { items: TEAM_DIRECTORY.items, nextCursor: null } }),
}));

const SESSION_ID = 'collaboration-session';
const CAPABILITIES = {
    readTranscript: true, submitAgentInput: true, editSessionRecords: true,
    approveRuntimePermissions: true, manageAccess: true, managePermissionDelegation: true,
    managePublicLink: true, archiveSession: true, renameSession: true,
    assignResponsibility: true, stopSession: true, deleteSession: true,
};
const OWNER = { kind: 'account', accountId: 'manager', firstName: null, lastName: null, username: 'manager', avatarUrl: null };
const RECIPIENT_ID = 'alice';
const GRANT_ROW = {
    grant: { subject: { kind: 'account' as const, accountId: RECIPIENT_ID }, accessLevel: 'view', canApprovePermissions: false },
    principal: { kind: 'account', accountId: RECIPIENT_ID, firstName: 'Alice', lastName: null, username: 'alice', avatarUrl: null },
    allowedTransitions: { accessLevels: ['view', 'edit', 'admin'], canChangePermissionDelegation: true, canRemove: true },
};
const TEAM_GRANT_ROW = {
    grant: { subject: { kind: 'team' as const, teamId: 'team-acme' }, accessLevel: 'edit', canApprovePermissions: false, requiredByTeamPolicy: true },
    principal: { kind: 'team', teamId: 'team-acme', name: 'Acme' },
    allowedTransitions: { accessLevels: ['edit', 'admin'], canChangePermissionDelegation: false, canRemove: false, reason: 'session_access_team_policy_required' },
};

type EnvelopePage = Readonly<{
    summary: Readonly<{ prepared: number; pending: number; invalid: number; recipientKeyUnavailable: number }>;
    items: readonly unknown[];
    nextCursor?: string | null;
}>;

function createRecipientEnvelopeItem() {
    const content = tweetnacl.box.keyPair();
    const signing = tweetnacl.sign.keyPair();
    return {
        recipientAccountId: RECIPIENT_ID,
        envelopeState: 'missing',
        contentKey: {
            status: 'available',
            accountSigningPublicKey: encodeHex(signing.publicKey),
            contentPublicKey: encodeBase64(content.publicKey, 'base64'),
            contentPublicKeySignature: encodeBase64(signAccountContentKeyBindingV1({
                accountSigningSecretKey: signing.secretKey,
                contentPublicKey: content.publicKey,
            }), 'base64'),
        },
    };
}

/**
 * These Actions carry `safety: 'danger'`, so the shared Actions front door requires
 * a confirmation on the `ui` surface unless the Account waived it. This suite owns
 * the recipient-key ordering contract, not that policy, so it states the waiver
 * through the canonical settings owner instead of leaving the outcome to whichever
 * approval host happens to be reachable.
 *
 * Whether the editor's own add/remove should carry that confirmation at all is an
 * open question for the shared Actions owner; see the handoff notes.
 */
function waiveSharedActionConfirmation(scope: Readonly<{ serverId: string; accountId: string }>) {
    const settingsScope = createAccountSettingsScope(scope.serverId, scope.accountId);
    if (!settingsScope) throw new Error('The settings scope owner rejected this Home/Account pair');
    storage.getState().applySettingsForScope(
        settingsScope,
        {
            ...settingsParse({}),
            actionsSettingsV1: {
                v: 1,
                actions: {},
                approvalWaivedSurfaces: {
                    'session.access.grant.set': ['ui'],
                    'session.access.grant.remove': ['ui'],
                    'session.access.context.set': ['ui'],
                },
            },
        },
        1,
    );
}

async function setupHome(options: Readonly<{ collaboration: boolean; encrypted: boolean; sessionEncrypted?: boolean }>) {
    const sessionEncrypted = options.sessionEncrypted ?? options.encrypted;
    TEAM_DIRECTORY.items = [];
    const profile = await upsertServerProfile({ name: 'Access Home', serverUrl: 'https://collaboration.example.test' });
    MANAGER.serverId = profile.id;
    MANAGER.keys = options.encrypted ? tweetnacl.box.keyPair() : null;

    const features = createRootLayoutFeaturesResponse();
    if (!tryWriteServerEnabledBitInPlace(features, 'sessions.collaboration', options.collaboration)) {
        throw new Error('The collaboration feature bit could not be written by its own writer');
    }
    primeServerFeaturesSnapshot({ serverId: profile.id, snapshot: { status: 'ready', features } });
    waiveSharedActionConfirmation({ serverId: profile.id, accountId: MANAGER.accountId });

    // Only Session-scoped requests are recorded. Direct Account sealing precedes
    // the atomic grant request; the broader audience pass follows acknowledgement.
    const paths: string[] = [];
    /** The exact collection view each envelope GET asked for, in order. */
    const envelopeStates: string[] = [];
    const recipientEnvelopeItem = createRecipientEnvelopeItem();
    const state = {
        granted: false,
        grantAccessLevel: 'view' as 'view' | 'edit' | 'admin',
        grantMode: 'normal' as 'normal' | 'malformed_after_commit' | 'malformed_without_commit',
        primaryTeamId: null as string | null,
        includeRequiredTeamGrant: false,
        contextMode: 'normal' as 'normal' | 'denied' | 'malformed_after_commit' | 'malformed_without_commit',
        envelopePages: sessionEncrypted ? [{ summary: { prepared: 0, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] }] as EnvelopePage[] : [],
        envelopeStatus: 200,
        uploaded: null as null | { recipientAccountId: string; encryptedDataKey: string },
        directEnvelope: null as null | string,
        sessionSnapshotGates: new Map<string, Promise<void>>(),
    };
    const sessionDataKey = new Uint8Array(32).fill(11);

    setRuntimeFetch(async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === '/v1/auth/ping') return new Response('{}');
        if (path.startsWith('/v2/sessions/')) paths.push(`${init?.method === 'PATCH' ? 'PATCH ' : ''}${path}`);
        // The shared Action front door reads the Account's own settings before it
        // dispatches; this Home has never stored any.
        if (path === '/v2/account/settings') return new Response(JSON.stringify({ content: null, version: 0 }));
        // The Home answers the mode and the currentness reads with their own exact
        // response schemas; both are strict, so the boundary must not blur them.
        if (path === '/v1/account/encryption') {
            return new Response(JSON.stringify({ mode: options.encrypted ? 'e2ee' : 'plain', updatedAt: 1 }));
        }
        if (path === '/v1/account/encryption/currentness') {
            return new Response(JSON.stringify(options.encrypted
                ? { mode: 'e2ee', version: 1, signingKeyFingerprint: 'signing', contentKeyFingerprint: 'content', updatedAt: 1, recipientEnvelopeReadiness: { status: 'available' } }
                : { mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1, recipientEnvelopeReadiness: { status: 'unavailable', reason: 'plain_account' } }));
        }
        if (path === `/v1/user/${RECIPIENT_ID}`) {
            const key = recipientEnvelopeItem.contentKey;
            if (key.status !== 'available') throw new Error('Expected available recipient key');
            return new Response(JSON.stringify({ user: {
                id: RECIPIENT_ID, firstName: 'Alice', lastName: null, username: 'alice', avatar: null,
                bio: null, badges: [], status: 'friend', publicKey: key.accountSigningPublicKey,
                recipientEnvelopeReadiness: { status: 'available' },
                contentPublicKey: key.contentPublicKey, contentPublicKeySig: key.contentPublicKeySignature,
            } }));
        }
        // A `direct_only` Home has no current access-grant operation at all: the
        // released Account-direct route is the real transport the seam-owned
        // adapter must use, so this suite serves it rather than the current one.
        if (path === `/v1/sessions/${SESSION_ID}/shares`) {
            return new Response(JSON.stringify({ shares: state.granted ? [{
                id: 'released-share', accessLevel: state.grantAccessLevel, canApprovePermissions: false,
                sharedWithUser: { id: RECIPIENT_ID, firstName: 'Alice', lastName: null, username: 'alice', avatar: null },
            }] : [] }));
        }
        if (path === '/v2/sessions/access-grants/list') {
            return new Response(JSON.stringify({
                visibility: 'complete', owner: OWNER, primaryTeamId: state.primaryTeamId,
                grants: [...(state.granted ? [{...GRANT_ROW,grant:{...GRANT_ROW.grant,accessLevel:state.grantAccessLevel}}] : []), ...(state.includeRequiredTeamGrant ? [TEAM_GRANT_ROW] : [])],
                effectiveAccess: { v: 1, level: 'owner', sources: [{ kind: 'owner' }], capabilities: CAPABILITIES },
            }));
        }
        if (path === '/v2/sessions/access-context/set') {
            const body = JSON.parse(String(init?.body)) as { primaryTeamId: string | null };
            if (state.contextMode === 'denied') {
                return new Response(JSON.stringify({ error: 'session_access_external_sharing_disabled' }), { status: 403 });
            }
            if (state.contextMode !== 'malformed_without_commit') state.primaryTeamId = body.primaryTeamId;
            if (state.contextMode === 'malformed_after_commit') return new Response('{}');
            if (state.contextMode === 'malformed_without_commit') return new Response('{}');
            return new Response(JSON.stringify({ changed: true, primaryTeamId: state.primaryTeamId }));
        }
        if (path === '/v2/sessions/access-grants/set') {
            const body = JSON.parse(String(init?.body)) as {
                accessLevel: 'view' | 'edit' | 'admin';
                accountEnvelopeInput?: { encryptedDataKey: string };
            };
            state.directEnvelope = body.accountEnvelopeInput?.encryptedDataKey ?? null;
            if (state.grantMode !== 'malformed_without_commit') {
                state.granted = true;
                state.grantAccessLevel = body.accessLevel;
            }
            if (state.grantMode !== 'normal') return new Response('{}');
            return new Response(JSON.stringify({ changed: true, grant: {...GRANT_ROW.grant,accessLevel:state.grantAccessLevel} }));
        }
        if (path === '/v2/sessions/access-grants/remove') {
            state.granted = false;
            return new Response(JSON.stringify({ changed: true, subject: GRANT_ROW.grant.subject }));
        }
        if (path === `/v1/sessions/${SESSION_ID}/shares`) {
            return new Response(JSON.stringify({ shares: [] }));
        }
        const sessionSnapshotMatch = path.match(/^\/v2\/sessions\/([^/]+)$/);
        if (sessionSnapshotMatch) {
            const sessionId = decodeURIComponent(sessionSnapshotMatch[1]!);
            await state.sessionSnapshotGates.get(sessionId);
            return new Response(JSON.stringify({ session: {
                id: sessionId, createdAt: 1, updatedAt: 2, seq: 3, active: true, activeAt: 2,
                encryptionMode: sessionEncrypted ? 'e2ee' : 'plain',
                dataEncryptionKey: sessionEncrypted && MANAGER.keys
                    ? encryptDataKeyForRecipientV0(sessionDataKey, encodeBase64(MANAGER.keys.publicKey, 'base64'))
                    : null,
                // `metadata` is a required string on the canonical record. A null here
                // is not a "metadata-free" Session: it fails the by-ID parse and sends
                // the read down the compat list fallback, so the key pass would never
                // see this Session's own envelope.
                metadataLayoutVersion: 0, metadataVersion: 4, metadata: '',
                agentStateVersion: 5, agentState: null, share: null,
                // A collaboration-enabled Home is asked for `accessProjectionVersion=1`,
                // and that projection is parsed strictly: without the effective-access
                // and responsibility pair the by-ID read returns `invalid_response`, so
                // every sealing path that must open this Session's key fails first.
                effectiveAccess: { v: 1, level: 'owner', sources: [{ kind: 'owner' }], capabilities: CAPABILITIES },
                responsibleAccountId: null, responsibleAccount: null,
            } }));
        }
        if (path.endsWith('/turns')) return new Response('{}', { status: 404 });
        if (path.endsWith('/data-key/envelopes')) {
            if (state.envelopeStatus !== 200) return new Response(JSON.stringify({ error: 'session_data_key_envelope_request_failed' }), { status: state.envelopeStatus });
            if (!sessionEncrypted) return new Response(JSON.stringify({ status: 'not_required' }));
            if (init?.method === 'PATCH') {
                const body = JSON.parse(String(init.body)) as { entries: NonNullable<typeof state.uploaded>[] };
                state.uploaded = body.entries[0] ?? null;
                return new Response(JSON.stringify({ appliedCount: body.entries.length }));
            }
            envelopeStates.push(new URL(String(url)).searchParams.get('state') ?? 'action_required');
            const page = state.envelopePages.shift();
            if (!page) throw new Error('Unexpected extra envelope page request');
            return new Response(JSON.stringify({
                status: 'required', summary: page.summary, items: page.items,
                nextCursor: page.nextCursor ?? null,
            }));
        }
        throw new Error(`Unexpected request ${path}`);
    });

    return { profile, paths, envelopeStates, state, sessionDataKey };
}

function Probe(props: Readonly<{ serverId: string; sessionId?: string; onRender: (controller: SessionAccessEditorController) => void }>) {
    props.onRender(useLiveSessionAccessEditorController({
        scope: { serverId: props.serverId, accountId: MANAGER.accountId },
        sessionId: props.sessionId ?? SESSION_ID,
    }));
    return null;
}

async function mountController(serverId: string) {
    let latest: SessionAccessEditorController | null = null;
    await renderScreen(<Probe serverId={serverId} onRender={(controller) => { latest = controller; }} />);
    await vi.waitFor(() => expect(latest!.model.content).toEqual(expect.objectContaining({
        hasLastAcknowledgedSnapshot: true,
    })), { timeout: 5000 });
    return () => latest!;
}

beforeEach(() => { TEAM_DIRECTORY.failed = false; });

afterEach(() => {
    standardCleanup();
    storage.setState(storage.getInitialState(), true);
});

describe('useLiveSessionAccessEditorController encrypted-access preparation', () => {
    it('keeps a direct-only Home Account-only and exposes no current Team-context control', async () => {
        // `direct_only` reaches the Home through the released Account-direct
        // adapter, so this Home must be the encryption-capable one the released
        // seam expects while the Session itself stays plain.
        const home = await setupHome({ collaboration: false, encrypted: true, sessionEncrypted: false });
        const controller = await mountController(home.profile.id);

        expect(controller().model.context).toBeUndefined();
        expect(controller().model.directory.sections.map((section) => section.kind)).toEqual(['account']);
    });

    it('starts preparation for a replacement Session while the previous scope is still in flight', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.envelopePages = [
            { summary: { prepared: 0, pending: 1, invalid: 0, recipientKeyUnavailable: 0 }, items: [createRecipientEnvelopeItem()] },
            // Replacement Session discovery.
            { summary: { prepared: 0, pending: 1, invalid: 0, recipientKeyUnavailable: 0 }, items: [createRecipientEnvelopeItem()] },
            // Replacement Session preparation and its final recheck.
            { summary: { prepared: 0, pending: 1, invalid: 0, recipientKeyUnavailable: 0 }, items: [createRecipientEnvelopeItem()] },
            { summary: { prepared: 1, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] },
            // The settled replacement pass re-reads its exceptions.
            { summary: { prepared: 1, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] },
        ];
        let releasePreviousSession!: () => void;
        home.state.sessionSnapshotGates.set(SESSION_ID, new Promise<void>((resolve) => {
            releasePreviousSession = resolve;
        }));

        let latest: SessionAccessEditorController | null = null;
        const onRender = (controller: SessionAccessEditorController) => { latest = controller; };
        const screen = await renderScreen(<Probe serverId={home.profile.id} onRender={onRender} />);
        await vi.waitFor(() => expect(latest!.model.encryption?.actionLabel).toBe('Prepare now'));

        act(() => { latest!.actions.prepareAccess(); });
        await vi.waitFor(() => expect(home.paths).toContain(`/v2/sessions/${SESSION_ID}`));

        const replacementSessionId = 'replacement-session';
        await screen.update(<Probe serverId={home.profile.id} sessionId={replacementSessionId} onRender={onRender} />);
        await vi.waitFor(() => expect(latest!.model.encryption?.actionLabel).toBe('Prepare now'));
        act(() => { latest!.actions.prepareAccess(); });

        await vi.waitFor(() => expect(home.paths).toContain(`/v2/sessions/${replacementSessionId}`));
        await vi.waitFor(() => expect(latest!.model.encryption?.progressLabel).toBeUndefined());
        await act(async () => { releasePreviousSession(); });
    });

    it('keeps a plain Session free of encrypted-access warnings when discovery is not required', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true, sessionEncrypted: false });
        const controller = await mountController(home.profile.id);

        await vi.waitFor(() => expect(home.paths).toContain(`/v2/sessions/${SESSION_ID}/data-key/envelopes`));

        expect(controller().model.encryption).toBeUndefined();
        expect(controller().model.content.issue).toBeUndefined();
    });

    it('offers eligible ungranted Teams and confirms required-floor and external-policy consequences before mutation', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        TEAM_DIRECTORY.items = [{
            id: 'team-acme',
            name: 'Acme',
            policy: { sessionCreationPolicy: 'team_required', externalSharingPolicy: 'disabled' },
        }];
        const controller = await mountController(home.profile.id);

        expect(controller().model.context).toMatchObject({ primaryTeamId: null });
        await vi.waitFor(() => expect(controller().model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-acme', label: 'Acme' }),
        ])));
        expect(controller().model.grants).toHaveLength(0);
        await act(async () => { controller().actions.setContext('team-acme'); });
        expect(controller().model.context?.confirmation?.consequences).toEqual(expect.arrayContaining([
            expect.stringContaining('Required'),
            expect.stringContaining('External'),
        ]));
        expect(home.paths).not.toContain('/v2/sessions/access-context/set');
        await act(async () => { controller().actions.confirmContext(); });
        await vi.waitFor(() => expect(controller().model.context?.primaryTeamId).toBe('team-acme'));
        expect(home.paths).toContain('/v2/sessions/access-context/set');
        expect(runTeamAction).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'teams.list' }));
    });

    it('keeps a typed context denial visible without changing the acknowledged context', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        TEAM_DIRECTORY.items = [{
            id: 'team-acme',
            name: 'Acme',
            policy: { sessionCreationPolicy: 'team_required', externalSharingPolicy: 'disabled' },
        }];
        home.state.contextMode = 'denied';
        const controller = await mountController(home.profile.id);
        await vi.waitFor(() => expect(controller().model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-acme' }),
        ])));

        await act(async () => { controller().actions.setContext('team-acme'); });
        await act(async () => { controller().actions.confirmContext(); });
        await vi.waitFor(() => expect(controller().model.context?.error?.code)
            .toBe('session_access_external_sharing_disabled'));

        expect(controller().model.context?.primaryTeamId).toBeNull();
        expect(controller().model.context?.error?.message).toMatch(/external sharing/i);
    });

    it('reconciles an unknown context response from the authoritative inspection', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        TEAM_DIRECTORY.items = [{
            id: 'team-acme',
            name: 'Acme',
            policy: { sessionCreationPolicy: 'private_default', externalSharingPolicy: 'allowed' },
        }];
        home.state.contextMode = 'malformed_after_commit';
        const controller = await mountController(home.profile.id);
        await vi.waitFor(() => expect(controller().model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-acme' }),
        ])));

        await act(async () => { controller().actions.setContext('team-acme'); });
        await vi.waitFor(() => expect(controller().model.context?.primaryTeamId).toBe('team-acme'));

        expect(controller().model.context?.operation).toBe('idle');
        expect(controller().model.context?.error).toBeUndefined();
        expect(home.paths.filter((path) => path === '/v2/sessions/access-grants/list')).toHaveLength(2);
    });

    it('keeps an outcome-unknown context error when inspection disproves the requested change', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        TEAM_DIRECTORY.items = [{
            id: 'team-acme',
            name: 'Acme',
            policy: { sessionCreationPolicy: 'private_default', externalSharingPolicy: 'allowed' },
        }];
        home.state.contextMode = 'malformed_without_commit';
        const controller = await mountController(home.profile.id);
        await vi.waitFor(() => expect(controller().model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-acme' }),
        ])));

        await act(async () => { controller().actions.setContext('team-acme'); });
        await vi.waitFor(() => expect(controller().model.context?.operation).toBe('error'));

        expect(controller().model.context?.primaryTeamId).toBeNull();
        expect(controller().model.context?.error).toMatchObject({
            code: 'outcome_unknown', retryable: true,
        });
    });

    it('allows Personal recovery when the current Team relaxed a stale required marker', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.primaryTeamId = 'team-acme';
        home.state.includeRequiredTeamGrant = true;
        TEAM_DIRECTORY.items = [{
            id: 'team-acme', name: 'Acme',
            policy: { sessionCreationPolicy: 'team_default', externalSharingPolicy: 'allowed' },
        }];
        const controller = await mountController(home.profile.id);

        await vi.waitFor(() => expect(controller().model.context?.options.find((option) => option.teamId === null)?.blockedReason)
            .toBeUndefined());
        act(() => { controller().actions.setContext(null); });
        await vi.waitFor(() => expect(controller().model.context?.primaryTeamId).toBeNull());
        expect(home.paths).toContain('/v2/sessions/access-context/set');
    });

    it('keeps an active team_required context locked from Personal and replacement Teams', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.primaryTeamId = 'team-acme';
        home.state.includeRequiredTeamGrant = true;
        TEAM_DIRECTORY.items = [
            { id: 'team-acme', name: 'Acme', policy: { sessionCreationPolicy: 'team_required', externalSharingPolicy: 'allowed' } },
            { id: 'team-design', name: 'Design', policy: { sessionCreationPolicy: 'team_default', externalSharingPolicy: 'allowed' } },
        ];
        const controller = await mountController(home.profile.id);

        await vi.waitFor(() => expect(controller().model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: null, blockedReason: expect.objectContaining({ code: 'session_access_team_policy_required' }) }),
            expect.objectContaining({ teamId: 'team-design', blockedReason: expect.objectContaining({ code: 'session_access_team_policy_required' }) }),
        ])));
        act(() => { controller().actions.setContext(null); });
        act(() => { controller().actions.setContext('team-design'); });
        expect(home.paths).not.toContain('/v2/sessions/access-context/set');
    });

    it('allows context recovery when the complete active Team directory no longer contains the current Team', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.primaryTeamId = 'team-acme';
        home.state.includeRequiredTeamGrant = true;
        const controller = await mountController(home.profile.id);

        await vi.waitFor(() => expect(controller().model.context?.options.find((option) => option.teamId === null)?.blockedReason)
            .toBeUndefined());
        act(() => { controller().actions.setContext(null); });
        await vi.waitFor(() => expect(controller().model.context?.primaryTeamId).toBeNull());
    });

    it('fails closed while the exact current Team policy is transiently unknown', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.primaryTeamId = 'team-acme';
        home.state.includeRequiredTeamGrant = true;
        TEAM_DIRECTORY.failed = true;
        const controller = await mountController(home.profile.id);

        await vi.waitFor(() => expect(controller().model.context?.options.find((option) => option.teamId === null)?.blockedReason)
            .toMatchObject({ code: 'session_access_context_policy_unavailable' }));
        act(() => { controller().actions.setContext(null); });
        expect(home.paths).not.toContain('/v2/sessions/access-context/set');
    });

    it('starts the recipient-key pass only after the Home acknowledges the grant, and renders the Home summary', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.envelopePages = [
            { summary: { prepared: 0, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] },
            { summary: { prepared: 0, pending: 1, invalid: 0, recipientKeyUnavailable: 0 }, items: [createRecipientEnvelopeItem()] },
            { summary: { prepared: 0, pending: 1, invalid: 0, recipientKeyUnavailable: 0 }, items: [createRecipientEnvelopeItem()] },
            // The final recheck page is what the aggregate line must describe: other
            // recipients still need work that this pass did not discover in its slice.
            { summary: { prepared: 1, pending: 2, invalid: 0, recipientKeyUnavailable: 0 }, items: [] },
            // The settled pass re-reads the exceptions listed beneath the aggregate.
            { summary: { prepared: 1, pending: 2, invalid: 0, recipientKeyUnavailable: 0 }, items: [] },
        ];
        const controller = await mountController(home.profile.id);

        await act(async () => { controller().actions.addPrincipal({ kind: 'account', accountId: RECIPIENT_ID }); });
        await vi.waitFor(() => expect(controller().model.grants).toHaveLength(1));
        await vi.waitFor(() => expect(controller().model.encryption?.actionLabel).toBeDefined());

        // The direct envelope is prepared before the atomic grant, while the
        // broader audience pass follows the authoritative refresh.
        const sessionRead = home.paths.indexOf(`/v2/sessions/${SESSION_ID}`);
        const grantWrite = home.paths.indexOf('/v2/sessions/access-grants/set');
        const acknowledgedRefresh = home.paths.indexOf('/v2/sessions/access-grants/list', grantWrite + 1);
        const preparationRead = home.paths.indexOf(`/v2/sessions/${SESSION_ID}/data-key/envelopes`, acknowledgedRefresh + 1);
        const preparationWrite = home.paths.indexOf(`PATCH /v2/sessions/${SESSION_ID}/data-key/envelopes`);
        // Assert the user-visible security/lifecycle order without requiring an
        // incidental number of read-only policy or projection requests.
        expect(sessionRead).toBeGreaterThanOrEqual(0);
        expect(grantWrite).toBeGreaterThan(sessionRead);
        expect(acknowledgedRefresh).toBeGreaterThan(grantWrite);
        expect(preparationRead).toBeGreaterThan(acknowledgedRefresh);
        expect(preparationWrite).toBeGreaterThan(preparationRead);
        // The recipient really was sealed the Session's own key by the canonical owner.
        expect(home.state.uploaded?.recipientAccountId).toBe(RECIPIENT_ID);
        expect(home.state.directEnvelope).toEqual(expect.any(String));
        // One Session-scoped line from the Home's summary, not a count of grant rows:
        // the recheck reported one prepared and two still pending across the whole audience.
        expect(controller().model.encryption?.summaryLabel).toBe('1 prepared · 2 pending');
        expect(controller().model.encryption?.actionLabel).toBe('Prepare now');
        // The diagnostic is reachable from the mounted editor, not only from a defect.
        expect(controller().model.encryption?.showAllLabel).toBe('Show all people');
        expect(controller().model.grants).toHaveLength(1);
        expect(controller().model.grants[0]?.operation).toEqual({ kind: 'idle' });
    });

    it('keeps an acknowledged grant successful when preparation fails', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.envelopeStatus = 500;
        const controller = await mountController(home.profile.id);

        await act(async () => { controller().actions.addPrincipal({ kind: 'account', accountId: RECIPIENT_ID }); });
        await vi.waitFor(() => expect(controller().model.grants).toHaveLength(1));
        await vi.waitFor(() => expect(controller().model.encryption).toBeDefined());

        // The grant committed. Only the separate encryption obligation failed.
        expect(controller().model.grants).toHaveLength(1);
        expect(controller().model.grants[0]?.operation).toEqual({ kind: 'idle' });
        expect(controller().model.content.issue).toBeUndefined();
        // The line names the key owner's own failure, so it stays distinguishable
        // from a grant failure the row would have to own instead.
        expect(controller().model.encryption?.error?.code).toBe('session_data_key_envelope_request_failed');
    });

    it('settles a lost set response when the authoritative inspection proves the exact mutation committed', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.granted = true;
        home.state.grantMode = 'malformed_after_commit';
        home.state.envelopePages.push({ summary: { prepared: 0, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] });
        const controller = await mountController(home.profile.id);
        await vi.waitFor(() => expect(controller().model.grants[0]?.level).toMatchObject({ value: 'view' }));

        await act(async () => { controller().actions.setAccessLevel(GRANT_ROW.grant.subject, 'edit'); });
        await vi.waitFor(() => expect(controller().model.grants[0]?.level).toMatchObject({ value: 'edit' }));
        expect(controller().model.grants[0]?.operation).toEqual({ kind: 'idle' });
    });

    it('keeps a retryable row error when the authoritative inspection disproves the requested mutation', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.granted = true;
        home.state.grantMode = 'malformed_without_commit';
        home.state.envelopePages.push({ summary: { prepared: 0, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] });
        const controller = await mountController(home.profile.id);
        await vi.waitFor(() => expect(controller().model.grants[0]?.level).toMatchObject({ value: 'view' }));

        await act(async () => { controller().actions.setAccessLevel(GRANT_ROW.grant.subject, 'edit'); });
        await vi.waitFor(() => expect(controller().model.grants[0]?.operation.kind).toBe('error'));
        expect(controller().model.grants[0]?.level).toMatchObject({ value: 'view' });
        expect(controller().model.grants[0]?.operation).toMatchObject({
            kind: 'error', error: { code: 'outcome_unknown', retryable: true },
        });
    });

    it('refreshes the aggregate but does not seal anything for an audience a revocation just made smaller', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.granted = true;
        home.state.envelopePages.push({ summary: { prepared: 0, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] });
        const controller = await mountController(home.profile.id);
        await vi.waitFor(() => expect(controller().model.grants).toHaveLength(1));

        await act(async () => { controller().actions.requestRemove(GRANT_ROW.grant.subject); });
        await act(async () => { controller().actions.confirmRemove(GRANT_ROW.grant.subject); });
        await vi.waitFor(() => expect(controller().model.grants).toHaveLength(0));

        // The removed recipient's stored tuple goes inert at the key owner. The
        // authoritative aggregate refreshes, but no key is opened and no page is patched.
        expect(home.paths.some((path) => path.startsWith('PATCH '))).toBe(false);
        expect(home.paths.filter((path) => path === `/v2/sessions/${SESSION_ID}`)).toHaveLength(0);
        // A healthy audience stays quiet: one ready line and no preparation action.
        expect(controller().model.encryption?.actionLabel).toBeUndefined();
        expect(controller().model.encryption?.summaryLabel).toBe('Encrypted access ready');
    });

    it('refreshes an open editor when the exact Session is invalidated elsewhere, and ignores unrelated wakes', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true, sessionEncrypted: false });
        home.state.granted = true;
        const controller = await mountController(home.profile.id);
        await vi.waitFor(() => expect(controller().model.grants).toHaveLength(1));
        const listPath = '/v2/sessions/access-grants/list';
        const listsAfterMount = home.paths.filter((path) => path === listPath).length;

        // Another manager revoked this grant. The content-free Account-change wake
        // is the only hint; the authoritative list stays the access state owner.
        home.state.granted = false;
        await act(async () => { publishHomeAccountChange(home.profile.id, [SESSION_ID]); });
        await vi.waitFor(() => expect(controller().model.grants).toHaveLength(0));

        // A wake that names only other Sessions, or another Home entirely, must not
        // make this editor refetch its private roster.
        const listsAfterRevocation = home.paths.filter((path) => path === listPath).length;
        await act(async () => {
            publishHomeAccountChange(home.profile.id, ['some-other-session']);
            publishHomeAccountChange('another-home', [SESSION_ID]);
        });
        expect(home.paths.filter((path) => path === listPath)).toHaveLength(listsAfterRevocation);
        expect(listsAfterRevocation).toBeGreaterThan(listsAfterMount);
    });

    it('loads the all-people diagnostic only when asked, then pages and collapses it', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.granted = true;
        home.state.envelopePages.push(
            // The explicit diagnostic: healthy rows included, and more behind a cursor.
            { summary: { prepared: 2, pending: 0, invalid: 0, recipientKeyUnavailable: 0 },
                items: [{ ...createRecipientEnvelopeItem(), recipientAccountId: 'first', envelopeState: 'prepared' }],
                nextCursor: encodeSessionDataKeyEnvelopeCursorV1('first') },
            { summary: { prepared: 2, pending: 0, invalid: 0, recipientKeyUnavailable: 0 },
                items: [{ ...createRecipientEnvelopeItem(), recipientAccountId: 'second', envelopeState: 'prepared' }] },
        );
        const controller = await mountController(home.profile.id);
        await vi.waitFor(() => expect(controller().model.encryption).toBeDefined());

        // Discovery never asks for healthy rows: the aggregate alone drives the line.
        expect(home.envelopeStates).toEqual(['action_required']);
        expect(controller().model.encryption?.recipients).toBeUndefined();

        await act(async () => { controller().actions.toggleAllRecipients(); });
        await vi.waitFor(() => expect(controller().model.encryption?.recipients?.rows).toHaveLength(1));
        expect(home.envelopeStates).toEqual(['action_required', 'all']);
        expect(controller().model.encryption?.recipients?.hasMore).toBe(true);
        expect(controller().model.encryption?.showAllLabel).toBe('Hide people');

        await act(async () => { controller().actions.loadMoreRecipients(); });
        await vi.waitFor(() => expect(controller().model.encryption?.recipients?.rows).toHaveLength(2));
        expect(controller().model.encryption?.recipients?.rows.map((row) => row.recipientAccountId))
            .toEqual(['first', 'second']);
        expect(controller().model.encryption?.recipients?.hasMore).toBe(false);

        // The mounted controller carries an exact repair intent through the real crypto/API
        // owner. The selected prepared recipient is behind another diagnostic page, and the
        // final diagnostic recheck still contains healthy rows after the acknowledged write.
        const firstPage: EnvelopePage = {
            summary: { prepared: 2, pending: 0, invalid: 0, recipientKeyUnavailable: 0 },
            items: [{ ...createRecipientEnvelopeItem(), recipientAccountId: 'first', envelopeState: 'prepared' }],
            nextCursor: encodeSessionDataKeyEnvelopeCursorV1('first'),
        };
        home.state.envelopePages.push(firstPage, {
            summary: firstPage.summary,
            items: [{ ...createRecipientEnvelopeItem(), recipientAccountId: 'second', envelopeState: 'prepared' }],
        }, firstPage, firstPage);
        await act(async () => { controller().actions.prepareAccess('second'); });
        await vi.waitFor(() => expect(home.state.uploaded?.recipientAccountId).toBe('second'));
        await vi.waitFor(() => expect(controller().model.encryption?.progressLabel).toBeUndefined());
        // The open view is re-read once the pass settles, through the same `all` transport.
        await vi.waitFor(() => expect(home.envelopeStates.slice(-4)).toEqual(['all', 'all', 'all', 'all']));
        expect(home.paths.filter(path => path === `PATCH /v2/sessions/${SESSION_ID}/data-key/envelopes`)).toHaveLength(1);
        expect(controller().model.encryption?.error).toBeUndefined();

        // Hiding the all-people view re-reads the current exceptions rather than
        // rendering an audience that may have changed meanwhile.
        home.state.envelopePages.push({ summary: { prepared: 2, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] });
        await act(async () => { controller().actions.toggleAllRecipients(); });
        await vi.waitFor(() => expect(controller().model.encryption?.recipients).toBeUndefined());
        expect(home.envelopeStates.at(-1)).toBe('action_required');
        expect(controller().model.encryption?.showAllLabel).toBe('Show all people');
    });

    it('lists the discovered exceptions beneath the aggregate by default and re-reads them after a pass', async () => {
        const home = await setupHome({ collaboration: true, encrypted: true });
        home.state.granted = true;
        home.state.envelopePages = [
            // Discovery already carries the exception rows the aggregate counts.
            { summary: { prepared: 0, pending: 1, invalid: 0, recipientKeyUnavailable: 0 }, items: [createRecipientEnvelopeItem()] },
        ];
        const controller = await mountController(home.profile.id);
        await vi.waitFor(() => expect(controller().model.encryption?.recipients?.rows).toHaveLength(1));

        // No second request: the default expansion is the discovery page itself.
        expect(home.envelopeStates).toEqual(['action_required']);
        expect(controller().model.encryption?.recipients?.rows[0]).toMatchObject({
            recipientAccountId: RECIPIENT_ID, state: 'pending', label: 'Alice',
        });
        expect(controller().model.encryption?.recipients?.hasMore).toBe(false);
        expect(controller().model.encryption?.showAllLabel).toBe('Show all people');

        // The pass seals the pending recipient; the rows beneath the aggregate must
        // then say what the Home says now, not what discovery said before the pass.
        home.state.envelopePages.push(
            { summary: { prepared: 0, pending: 1, invalid: 0, recipientKeyUnavailable: 0 }, items: [createRecipientEnvelopeItem()] },
            { summary: { prepared: 1, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] },
            { summary: { prepared: 1, pending: 0, invalid: 0, recipientKeyUnavailable: 0 }, items: [] },
        );
        await act(async () => { controller().actions.prepareAccess(); });
        await vi.waitFor(() => expect(home.state.uploaded?.recipientAccountId).toBe(RECIPIENT_ID));
        await vi.waitFor(() => expect(controller().model.encryption?.summaryLabel).toBe('Encrypted access ready'));
        await vi.waitFor(() => expect(controller().model.encryption?.recipients).toBeUndefined());
        expect(home.envelopeStates.at(-1)).toBe('action_required');
    });
});
