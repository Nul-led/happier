import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';
import { signAccountContentKeyBindingV1, tryWriteServerEnabledBitInPlace } from '@happier-dev/protocol';

import {
    createRootLayoutFeaturesResponse,
    renderSettingsView,
    standardCleanup,
    teamMembershipFixture,
    teamSummaryFixture,
} from '@/dev/testkit';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { encodeBase64 } from '@/encryption/base64';
import { encodeHex } from '@/encryption/hex';
import { SessionAccessApiError } from '@/sync/api/session/sessionAccessApi';
import { primeServerFeaturesSnapshot, resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storage';
import { encryptDataKeyForRecipientV0 } from '@/sync/encryption/directShareEncryption';
import { t } from '@/text';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';

import {
    TeamMemberEncryptionSection,
    classifyTeamMemberEncryptionDiscoveryFailure,
    classifyTeamMemberRecipientEncryptionState,
    projectTeamMemberEncryptionReadyState,
    projectTeamMemberPreparationOutcome,
} from './TeamMemberEncryptionSection';

afterEach(() => {
    standardCleanup();
    storage.setState(storage.getInitialState(), true);
    resetServerFeaturesClientForTests();
    resetRuntimeFetch();
    vi.restoreAllMocks();
});

function primeCollaboration(serverId: string): void {
    const features = createRootLayoutFeaturesResponse();
    for (const feature of ['sharing.session', 'sessions.collaboration'] as const) {
        if (!tryWriteServerEnabledBitInPlace(features, feature, true)) {
            throw new Error(`Unable to enable ${feature}`);
        }
    }
    primeServerFeaturesSnapshot({ serverId, snapshot: { status: 'ready', features } });
}

function createMountedContext(serverId: string, refresh: () => void) {
    const membership = teamMembershipFixture({
        id: 'membership-1',
        teamId: 'team-1',
        accountId: 'recipient-1',
    });
    return {
        scope: { serverId, accountId: 'manager-1' },
        address: { serverId, teamId: 'team-1' },
        team: teamSummaryFixture({ id: 'team-1' }),
        membership,
        mutationsAvailable: true,
        refresh,
    };
}

async function setupMountedMemberRequest(
    request: (url: string, init?: RequestInit) => Promise<Response>,
    options?: Readonly<{ accountEncryption?: 'e2ee' }>,
) {
    const profile = await upsertServerProfile({
        serverUrl: `https://member-encryption-${crypto.randomUUID()}.example.test`,
        name: 'Member encryption Home',
    });
    storage.getState().activateProfileScope({ serverId: profile.id, accountId: 'manager-1' });
    primeCollaboration(profile.id);

    const managerKeys = tweetnacl.box.keyPair();
    const token = `e30.${Buffer.from(JSON.stringify({ sub: 'manager-1' })).toString('base64url')}.signature`;
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({
        token,
        ...(options?.accountEncryption === 'e2ee' ? {
            encryption: {
                publicKey: encodeBase64(managerKeys.publicKey, 'base64'),
                machineKey: encodeBase64(managerKeys.secretKey, 'base64'),
            },
        } : {}),
    });
    setRuntimeFetch(async (url, init) => {
        if (new URL(String(url)).pathname === '/v1/auth/ping') return new Response('{}');
        return await request(String(url), init);
    });
    return { profile, managerKeys };
}

describe('classifyTeamMemberEncryptionDiscoveryFailure', () => {
    it('keeps transient Home and network failures retryable', () => {
        expect(classifyTeamMemberEncryptionDiscoveryFailure(new Error('network down'))).toEqual({
            kind: 'unavailable',
            reason: 'transient',
            retryable: true,
        });
    });

    it('does not offer retry for an unsupported membership-history resource', () => {
        expect(classifyTeamMemberEncryptionDiscoveryFailure(new SessionAccessApiError('unsupported_action'))).toEqual({
            kind: 'unavailable',
            reason: 'unsupported',
            retryable: false,
        });
    });
});

describe('member encrypted-access state', () => {
    it('presents an inconsistent recipient binding as repair rather than setup', () => {
        expect(classifyTeamMemberRecipientEncryptionState('encryption_inconsistent')).toBe('repair_required');
        expect(classifyTeamMemberRecipientEncryptionState('encryption_setup_required')).toBe('setup_required');
    });

    it('keeps repairable and permanently non-transferable history distinct', () => {
        expect(projectTeamMemberEncryptionReadyState({
            items: [],
            nextCursor: null,
            exceptions: {
                callerEnvelopeRepairRequiredCount: 2,
                callerVisibleNonTransferableSessionCount: 3,
            },
        })).toEqual({
            kind: 'ready',
            actionable: false,
            callerRepairRequired: true,
            nonTransferableHistory: true,
        });
    });

    it('keeps an incomplete pass actionable and preserves server exception truth', () => {
        expect(projectTeamMemberPreparationOutcome({
            status: 'incomplete',
            preparedCount: 4,
            skippedCount: 1,
            repairRequiredSessions: [{ serverId: 'home-1', sessionId: 'session-1' }],
            recipientUnavailableReason: null,
            exceptions: {
                callerEnvelopeRepairRequiredCount: 0,
                callerVisibleNonTransferableSessionCount: 2,
            },
        })).toEqual({
            kind: 'ready',
            actionable: true,
            callerRepairRequired: true,
            nonTransferableHistory: true,
        });
    });

    it('keeps server exception truth after a completed pass that failed nothing locally', () => {
        expect(projectTeamMemberPreparationOutcome({
            status: 'complete',
            preparedCount: 9,
            skippedCount: 0,
            // Nothing failed on this device, which must not erase what the Home reported.
            repairRequiredSessions: [],
            recipientUnavailableReason: null,
            exceptions: {
                callerEnvelopeRepairRequiredCount: 1,
                callerVisibleNonTransferableSessionCount: 4,
            },
        })).toEqual({
            kind: 'ready',
            actionable: false,
            callerRepairRequired: true,
            nonTransferableHistory: true,
        });
    });

    it('reloads the membership for a replacement Account instead of reporting a failure', () => {
        // A provider reset keeps the Team-membership id while replacing its Account.
        // Continuing would seal history to the person who left.
        expect(projectTeamMemberPreparationOutcome({
            status: 'recipient_changed',
            preparedCount: 2,
            skippedCount: 0,
            repairRequiredSessions: [],
            recipientUnavailableReason: null,
            exceptions: null,
        })).toEqual({ kind: 'recipient_changed' });
    });

    it('rediscovers an addressed membership that disappeared during commit', () => {
        expect(projectTeamMemberPreparationOutcome({
            status: 'membership_changed',
            preparedCount: 0,
            skippedCount: 0,
            repairRequiredSessions: [],
            recipientUnavailableReason: null,
            exceptions: null,
        })).toEqual({ kind: 'membership_changed' });
    });

    it('asks the Home again after a real scope change rather than settling on stale material', () => {
        expect(projectTeamMemberPreparationOutcome({
            status: 'scope_changed',
            preparedCount: 0,
            skippedCount: 0,
            repairRequiredSessions: [],
            recipientUnavailableReason: null,
            exceptions: null,
        })).toEqual({ kind: 'checking' });
    });

    it('stops on an unverifiable recipient binding without claiming preparation succeeded', () => {
        expect(projectTeamMemberPreparationOutcome({
            status: 'invalid_recipient_binding',
            preparedCount: 0,
            skippedCount: 0,
            repairRequiredSessions: [],
            recipientUnavailableReason: null,
            exceptions: null,
        })).toEqual({ kind: 'failed' });
    });

    it('reports an Account that cannot hold keys as setup, not as empty work', () => {
        expect(projectTeamMemberPreparationOutcome({
            status: 'recipient_unavailable',
            preparedCount: 0,
            skippedCount: 0,
            repairRequiredSessions: [],
            recipientUnavailableReason: 'encryption_setup_required',
            exceptions: null,
        })).toEqual({ kind: 'setup_required', reason: 'encryption_setup_required' });
    });
});

describe('TeamMemberEncryptionSection mounted membership history', () => {
    it.each([
        [
            'Team',
            undefined,
            '/v2/teams/team-1/members/membership-1/sessions/data-key/envelopes',
        ],
        [
            'exact Group',
            { kind: 'group' as const, teamGroupId: 'group-1', accountId: 'recipient-1' },
            '/v2/teams/team-1/groups/group-1/members/recipient-1/sessions/data-key/envelopes',
        ],
    ])('refreshes and conceals a removed %s membership after PATCH instead of offering a failed retry', async (
        _label,
        target,
        expectedPath,
    ) => {
        const recipientContent = tweetnacl.box.keyPair();
        const recipientSigning = tweetnacl.sign.keyPair();
        const refresh = vi.fn();
        let collectionGets = 0;
        let collectionPatches = 0;
        let managerKeys!: ReturnType<typeof tweetnacl.box.keyPair>;

        const request = vi.fn(async (url: string, init?: RequestInit) => {
            const path = new URL(url).pathname;
            if (path.includes('/account/encryption')) {
                return new Response(JSON.stringify({
                    mode: 'e2ee',
                    version: 1,
                    signingKeyFingerprint: 'signing-current',
                    contentKeyFingerprint: 'content-current',
                    updatedAt: 1,
                    recipientEnvelopeReadiness: { status: 'available' },
                }));
            }
            expect(path).toBe(expectedPath);
            if (init?.method === 'PATCH') {
                collectionPatches += 1;
                return new Response(JSON.stringify({ error: 'membership_not_found' }), { status: 404 });
            }
            collectionGets += 1;
            if (collectionGets === 3) {
                return new Response(JSON.stringify({ error: 'membership_not_found' }), { status: 404 });
            }
            return new Response(JSON.stringify({
                status: 'ready',
                recipientAccountId: 'recipient-1',
                contentKey: {
                    status: 'available',
                    accountSigningPublicKey: encodeHex(recipientSigning.publicKey),
                    contentPublicKey: encodeBase64(recipientContent.publicKey, 'base64'),
                    contentPublicKeySignature: encodeBase64(signAccountContentKeyBindingV1({
                        accountSigningSecretKey: recipientSigning.secretKey,
                        contentPublicKey: recipientContent.publicKey,
                    }), 'base64'),
                },
                items: [{
                    sessionId: 'session-1',
                    callerDataKeyEnvelope: encryptDataKeyForRecipientV0(
                        new Uint8Array(32).fill(7),
                        encodeBase64(managerKeys.publicKey, 'base64'),
                    ),
                }],
                exceptions: {
                    callerEnvelopeRepairRequiredCount: 0,
                    callerVisibleNonTransferableSessionCount: 0,
                },
                nextCursor: null,
            }));
        });
        const setup = await setupMountedMemberRequest(request, { accountEncryption: 'e2ee' });
        managerKeys = setup.managerKeys;
        const context = createMountedContext(setup.profile.id, refresh);
        const screen = await renderSettingsView(React.createElement(TeamMemberEncryptionSection, {
            context,
            target,
        }));

        await vi.waitFor(() => expect(screen.findRow('team-member-encryption-prepare')).not.toBeNull());
        screen.pressRow('team-member-encryption-prepare');

        await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(collectionGets).toBe(3));
        await vi.waitFor(() => expect(screen.findGroup('Encrypted access')).toBeNull());
        expect(screen.findRow('team-member-encryption-retry')).toBeNull();
        expect(collectionPatches).toBe(1);
    });

    it('renders an inconsistent recipient binding as repair rather than setup', async () => {
        const request = vi.fn(async (url: string) => {
            const path = new URL(url).pathname;
            expect(path).toBe('/v2/teams/team-1/members/membership-1/sessions/data-key/envelopes');
            return new Response(JSON.stringify({
                status: 'recipient_unavailable',
                recipientAccountId: 'recipient-1',
                contentKey: { status: 'unavailable', reason: 'encryption_inconsistent' },
            }));
        });
        const setup = await setupMountedMemberRequest(request);
        const screen = await renderSettingsView(React.createElement(TeamMemberEncryptionSection, {
            context: createMountedContext(setup.profile.id, vi.fn()),
        }));

        await vi.waitFor(() => expect(screen.findRow('team-member-encryption-setup-required')).not.toBeNull());
        // Assert the rendered copy, not the row instance's props: `findRow` resolves the
        // deepest host node, which never carries the composite `Item`'s `detail` prop, so a
        // props assertion here reads `undefined` for both the repair and the setup branch.
        const rendered = screen.getTextContent();
        expect(rendered).toContain(t('teams.members.encryption.repairRequired'));
        expect(rendered).not.toContain(t('teams.members.encryption.setupRequired'));
    });
});
