import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, renderScreen } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { tryWriteServerEnabledBitInPlace } from '@happier-dev/protocol';
import { primeServerFeaturesSnapshot, resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { ExternalSessionSharingAvailability } from '@/components/sessions/external/sharing/useExternalSessionSharingAvailability';
import { notifySessionPublicLinkInvalidated } from '@/sync/domains/social/sessionPublicLinkInvalidation';
import { publishHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';
import { SessionAccessApiError } from '@/sync/api/session/sessionAccessApi';
import { SessionPublicLinkSection } from './SessionPublicLinkSection';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const publication = vi.hoisted(() => ({
    getPublicLink: vi.fn(),
    createPublicLink: vi.fn(),
    removePublicLink: vi.fn(),
    clientOptions: [] as unknown[],
    /** Every bearer the transport generated, in request order. */
    issuedTokens: [] as string[],
}));
const publicationDialog = vi.hoisted(() => ({ open: vi.fn() }));
const modal = vi.hoisted(() => ({ update: vi.fn(), hide: vi.fn() }));
const serverProfile = vi.hoisted(() => ({
    get: vi.fn(() => ({
        id: 'home-one',
        serverUrl: 'https://internal-home.example.test',
        shareableServerUrl: 'https://public-home.example.test',
        shareableServerUrlValidatedAgainstServerUrl: 'https://internal-home.example.test',
    })),
}));

// The canonical Session-access Action client is the replaced boundary; the
// mounted controller, its reconciliation, and its presentation stay real.
vi.mock('@/sync/api/session/sessionAccessApi', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/api/session/sessionAccessApi')>();
    return {
        ...actual,
        createSessionAccessClient: (options: unknown) => {
            publication.clientOptions.push(options);
            return {
                getPublicLink: publication.getPublicLink,
                createPublicLink: async (input: unknown) => {
                    const issue = (options as { onPublicLinkBearerIssued?: (token: string) => void })
                        .onPublicLinkBearerIssued;
                    // The real leaf reports the bearer it generated before it
                    // dispatches, so recovery evidence survives a lost response.
                    // Each request mints its own bearer, which is what makes a
                    // falsely promoted one observable.
                    const issued = `generated-by-transport-${publication.issuedTokens.length + 1}`;
                    publication.issuedTokens.push(issued);
                    issue?.(issued);
                    return await publication.createPublicLink(input);
                },
                removePublicLink: publication.removePublicLink,
            };
        },
    };
});
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope', () => ({
    runWithServerRequestAuthorityForServerAccountScope: async (
        options: { scope: unknown },
        run: (authority: unknown) => Promise<unknown>,
    ) => run({ scope: options.scope, context: { credentials: { token: 'token', secret: new Uint8Array() } } }),
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/readSessionSnapshotForAuthority', () => ({
    readSessionSnapshotForAuthority: async () => ({
        session: { ...session({ managePublicLink: true }), encryptionMode: 'plain' },
        callerDataKeyEnvelope: null,
    }),
}));
vi.mock('@/components/sessions/sharing/openPublicLinkDialog', () => ({
    openPublicLinkDialog: publicationDialog.open,
}));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: modal }).module;
});
/**
 * Feature availability is not mocked: the canonical decision runtime stays real
 * and only the exact Home's server snapshot is primed, so this suite proves the
 * section consumes the exact-server decision rather than any nearby snapshot.
 */
function primePublicLinkFeature(serverId: string, enabled: boolean): void {
    const features = createRootLayoutFeaturesResponse();
    if (!tryWriteServerEnabledBitInPlace(features, 'sharing.public', enabled)) {
        throw new Error('Unable to write sharing.public');
    }
    primeServerFeaturesSnapshot({ serverId, snapshot: { status: 'ready', features } });
}
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>()),
    getServerProfileById: serverProfile.get,
}));

const scope = { serverId: 'home-one', accountId: 'account-owner' };

function session(capabilities: Readonly<{ managePublicLink: boolean }>): Session {
    return {
        id: 'session-1',
        metadata: null,
        // A Session a current Home created: the canonical reader always names its
        // persisted layout, and an unmarked row is a historical (layout-0) one.
        metadataLayoutVersion: 1,
        currentStorageState: 'hosted',
        transcriptShareable: true,
        access: { capabilities },
    } as unknown as Session;
}

function hostedAvailability(): ExternalSessionSharingAvailability {
    return {
        sharingPresentation: {
            shareable: true,
            state: 'hosted',
            machineName: null,
            action: 'none',
            materializedThroughSourceAt: null,
        },
    } as unknown as ExternalSessionSharingAvailability;
}

describe('SessionPublicLinkSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        publication.clientOptions.length = 0;
        publication.issuedTokens.length = 0;
        // `clearAllMocks` only drops recorded calls: a queued `…Once` value or a
        // default implementation survives it. Every case below scripts this
        // transport precisely, so an unconsumed leftover from the previous case
        // would decide the next case's first read instead of its own fixture.
        publication.getPublicLink.mockReset();
        publication.createPublicLink.mockReset();
        publication.removePublicLink.mockReset();
        modal.update.mockReset();
        modal.hide.mockReset();
        resetServerFeaturesClientForTests();
        primePublicLinkFeature(scope.serverId, true);
        publicationDialog.open.mockResolvedValue('public-link-dialog');
    });

    it('does not expose or fetch publication when the exact Home does not advertise sharing.public', async () => {
        primePublicLinkFeature(scope.serverId, false);
        // Another Home advertising publication must not admit this section.
        primePublicLinkFeature('home-other', true);
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        expect(screen.findByTestId('session-public-link-row')).toBeNull();
        expect(publication.getPublicLink).not.toHaveBeenCalled();
    });

    it('renders publication as a sibling status/action group, never as an access principal', async () => {
        publication.getPublicLink.mockResolvedValue(null);
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-row')).not.toBeNull());
        expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Off');
        // Publication is not a grant: it must never appear inside the access editor rows.
        expect(screen.findByTestId('session-access-editor')).toBeNull();
    });

    it('passes the exact Home public endpoint into the incumbent publication dialog', async () => {
        publication.getPublicLink.mockResolvedValue(null);
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-row')).not.toBeNull());
        await screen.pressByTestIdAsync('session-public-link-row');
        expect(serverProfile.get).toHaveBeenCalledWith('home-one');
        expect(publicationDialog.open).toHaveBeenCalledWith(expect.objectContaining({
            serverUrl: 'https://public-home.example.test',
        }));
    });

    it('hands the invoking row to the publication dialog so focus returns to it', async () => {
        publication.getPublicLink.mockResolvedValue(null);
        const row = { focus: vi.fn(), isConnected: true };
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
            {
                createNodeMock: (element: React.ReactElement) => (
                    (element.props as Readonly<{ testID?: string }>).testID === 'session-public-link-row' ? row : null
                ),
            },
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-row')).not.toBeNull());
        await screen.pressByTestIdAsync('session-public-link-row');

        // The shared modal host restores focus only from an explicit ref, so the
        // dialog has to carry the control the user actually activated.
        expect(publicationDialog.open.mock.calls.at(-1)?.[0].focusReturnRef?.current).toBe(row);
    });

    it('never promotes a bearer for a regeneration the Home did not commit', async () => {
        const first = {
            id: 'p1', expiresAt: null, useCount: 0, maxUses: null,
            isConsentRequired: true, updatedAt: 1,
        };
        publication.getPublicLink
            .mockResolvedValueOnce(null)
            .mockResolvedValue(first);
        publication.createPublicLink
            .mockResolvedValueOnce(first)
            .mockRejectedValue(new SessionAccessApiError('outcome_unknown'));
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-row')).not.toBeNull());
        await screen.pressByTestIdAsync('session-public-link-row');

        // The presented dialog keeps the callbacks it was opened with; only
        // `publicShare` is merged into it after a successful create.
        const dialog = publicationDialog.open.mock.calls.at(-1)?.[0];
        const settings = { isConsentRequired: true };
        const created = await dialog.onCreate(settings);
        expect(created).toMatchObject({ id: 'p1', token: publication.issuedTokens[0] });

        // The physical executor owns one exact replay. If it still reports an
        // unknown outcome, this controller never guesses from mutable settings.
        await expect(dialog.onCreate(settings)).rejects.toThrow();
        expect(publication.issuedTokens).toHaveLength(2);
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Public link is active'));

        await screen.pressByTestIdAsync('session-public-link-row');
        expect(publicationDialog.open.mock.calls.at(-1)?.[0].publicShare).toMatchObject({
            id: 'p1',
            token: publication.issuedTokens[0],
        });
    });

    it('does not infer a committed regeneration from refreshed row metadata', async () => {
        const first = {
            id: 'p1', expiresAt: null, useCount: 0, maxUses: null,
            isConsentRequired: true, updatedAt: 1,
        };
        const regenerated = { ...first, id: 'p2', updatedAt: 2 };
        publication.getPublicLink
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(first)
            .mockResolvedValue(regenerated);
        publication.createPublicLink
            .mockResolvedValueOnce(first)
            .mockRejectedValue(new SessionAccessApiError('outcome_unknown'));
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-row')).not.toBeNull());
        await screen.pressByTestIdAsync('session-public-link-row');

        const dialog = publicationDialog.open.mock.calls.at(-1)?.[0];
        const settings = { isConsentRequired: true };
        await dialog.onCreate(settings);

        await expect(dialog.onCreate(settings)).rejects.toThrow();
        expect(publication.getPublicLink).toHaveBeenCalledTimes(1);
    });

    it('does not let a pre-create refresh overwrite the created publication or bearer', async () => {
        const staleRefresh = createDeferred<null>();
        const created = {
            id: 'p-created', expiresAt: null, useCount: 0, maxUses: null,
            isConsentRequired: true, updatedAt: 4,
        };
        publication.getPublicLink
            .mockResolvedValueOnce(null)
            .mockImplementationOnce(() => staleRefresh.promise);
        publication.createPublicLink.mockResolvedValue(created);
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Off'));
        await screen.pressByTestIdAsync('session-public-link-row');
        const dialog = publicationDialog.open.mock.calls.at(-1)?.[0];

        notifySessionPublicLinkInvalidated({ serverId: scope.serverId, sessionId: 'session-1' });
        await vi.waitFor(() => expect(publication.getPublicLink).toHaveBeenCalledTimes(2));
        const applied = await dialog.onCreate({ isConsentRequired: true });
        expect(applied).toMatchObject({ ...created, token: publication.issuedTokens[0] });

        await act(async () => { staleRefresh.resolve(null); });
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Public link is active'));
        expect(modal.update).toHaveBeenLastCalledWith('public-link-dialog', {
            publicShare: expect.objectContaining({ id: 'p-created', token: publication.issuedTokens[0] }),
        });
    });

    it('does not let a pre-delete refresh resurrect a publication after unknown-outcome reconciliation', async () => {
        const active = {
            id: 'p-active', expiresAt: null, useCount: 0, maxUses: null,
            isConsentRequired: true, updatedAt: 5,
        };
        const staleRefresh = createDeferred<typeof active>();
        publication.getPublicLink
            .mockResolvedValueOnce(active)
            .mockImplementationOnce(() => staleRefresh.promise)
            .mockResolvedValueOnce(null);
        publication.removePublicLink.mockRejectedValue(new SessionAccessApiError('outcome_unknown'));
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Public link is active'));
        await screen.pressByTestIdAsync('session-public-link-row');
        const dialog = publicationDialog.open.mock.calls.at(-1)?.[0];

        notifySessionPublicLinkInvalidated({ serverId: scope.serverId, sessionId: 'session-1' });
        await vi.waitFor(() => expect(publication.getPublicLink).toHaveBeenCalledTimes(2));
        await dialog.onDelete();
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Off'));

        await act(async () => { staleRefresh.resolve(active); });
        expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Off');
        expect(modal.update).toHaveBeenLastCalledWith('public-link-dialog', { publicShare: null });
    });

    it('updates open dialogs while retaining a bearer only for identical settings', async () => {
        const created = {
            id: 'p-current', expiresAt: null, useCount: 0, maxUses: null,
            isConsentRequired: true, updatedAt: 7,
        };
        const rotated = { ...created, useCount: 2, updatedAt: 8 };
        publication.getPublicLink
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(created)
            .mockResolvedValueOnce(rotated)
            .mockResolvedValueOnce(null);
        publication.createPublicLink.mockResolvedValue(created);
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Off'));
        await screen.pressByTestIdAsync('session-public-link-row');
        const dialog = publicationDialog.open.mock.calls.at(-1)?.[0];
        await dialog.onCreate({ isConsentRequired: true });

        await act(async () => { notifySessionPublicLinkInvalidated({ serverId: scope.serverId, sessionId: 'session-1' }); });
        await vi.waitFor(() => expect(modal.update).toHaveBeenLastCalledWith('public-link-dialog', {
            publicShare: { ...created, token: publication.issuedTokens[0] },
        }));

        await act(async () => { notifySessionPublicLinkInvalidated({ serverId: scope.serverId, sessionId: 'session-1' }); });
        await vi.waitFor(() => expect(modal.update).toHaveBeenLastCalledWith('public-link-dialog', {
            publicShare: { ...rotated, token: null },
        }));

        await act(async () => { notifySessionPublicLinkInvalidated({ serverId: scope.serverId, sessionId: 'session-1' }); });
        await vi.waitFor(() => expect(modal.update).toHaveBeenLastCalledWith('public-link-dialog', { publicShare: null }));
    });

    it('reports an active link and never exposes its secret token on the surface', async () => {
        publication.getPublicLink.mockResolvedValue({ id: 'p1', expiresAt: null, useCount: 3, maxUses: null, isConsentRequired: false, updatedAt: 1 });
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Public link is active'));
        const row = screen.findByTestId('session-public-link-row');
        expect(JSON.stringify([row?.props.accessibilityLabel, row?.props.subtitle, row?.props.detail])).not.toContain('super-secret-token');
    });

    it('does not fetch publication state without the explicit managePublicLink capability', async () => {
        publication.getPublicLink.mockResolvedValue(null);
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: false })} availability={hostedAvailability()} />,
        );
        expect(screen.findByTestId('session-public-link-row')).toBeNull();
        expect(publication.getPublicLink).not.toHaveBeenCalled();
    });

    it('keeps a section-local retry when publication load fails', async () => {
        publication.getPublicLink.mockRejectedValue(new Error('offline'));
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-retry')).not.toBeNull());
        publication.getPublicLink.mockResolvedValue(null);
        await screen.pressByTestIdAsync('session-public-link-retry');
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Off'));
    });

    it('leaves a twice-ambiguous create unresolved instead of promoting from a read', async () => {
        const committed = {
            id: 'p-committed', expiresAt: null, useCount: 0, maxUses: null,
            isConsentRequired: true, updatedAt: 2,
        };
        publication.getPublicLink
            .mockResolvedValueOnce(null)
            .mockResolvedValue(committed);
        publication.createPublicLink.mockRejectedValue(new SessionAccessApiError('outcome_unknown'));
        const screen = await renderScreen(
            <SessionPublicLinkSection scope={scope} sessionId="session-1" session={session({ managePublicLink: true })} availability={hostedAvailability()} />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-row')).not.toBeNull());
        await screen.pressByTestIdAsync('session-public-link-row');
        const dialogInput = publicationDialog.open.mock.calls.at(-1)?.[0];
        await expect(dialogInput.onCreate({ isConsentRequired: true })).rejects.toThrow();

        expect(publication.createPublicLink).toHaveBeenCalledTimes(1);
        expect(publication.getPublicLink).toHaveBeenCalledTimes(1);
    });

    it('refreshes every mounted owner controller for the exact Home and Session only', async () => {
        publication.getPublicLink.mockResolvedValue(null);
        const otherScope = { serverId: 'home-two', accountId: 'account-owner' };
        primePublicLinkFeature(otherScope.serverId, true);
        await renderScreen(
            <>
                <SessionPublicLinkSection
                    scope={scope}
                    sessionId="session-1"
                    session={session({ managePublicLink: true })}
                    availability={hostedAvailability()}
                    testID="home-one-public-link"
                />
                <SessionPublicLinkSection
                    scope={scope}
                    sessionId="session-1"
                    session={session({ managePublicLink: true })}
                    availability={hostedAvailability()}
                    testID="home-one-second-public-link"
                />
                <SessionPublicLinkSection
                    scope={otherScope}
                    sessionId="session-1"
                    session={session({ managePublicLink: true })}
                    availability={hostedAvailability()}
                    testID="home-two-public-link"
                />
            </>,
        );
        await vi.waitFor(() => expect(publication.getPublicLink).toHaveBeenCalledTimes(3));
        publication.getPublicLink.mockClear();

        notifySessionPublicLinkInvalidated({ serverId: 'home-one', sessionId: 'session-1' });

        await vi.waitFor(() => expect(publication.getPublicLink).toHaveBeenCalledTimes(2));
        // Every refreshed read is bound to the exact qualified Home/Account and
        // Session, never to whichever Home happens to be active.
        expect(publication.clientOptions.every((options) => {
            const bound = options as { scope: unknown; sessionId: string };
            return JSON.stringify(bound.scope) === JSON.stringify(scope) || JSON.stringify(bound.scope) === JSON.stringify(otherScope);
        })).toBe(true);
    });

    it('keeps the last good publication visible when an invalidation refresh is offline', async () => {
        publication.getPublicLink.mockResolvedValueOnce({
            id: 'p1', expiresAt: null, useCount: 3, maxUses: null,
            isConsentRequired: false, updatedAt: 1,
        });
        const screen = await renderScreen(
            <SessionPublicLinkSection
                scope={scope}
                sessionId="session-1"
                session={session({ managePublicLink: true })}
                availability={hostedAvailability()}
            />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Public link is active'));
        publication.getPublicLink.mockRejectedValueOnce(new Error('offline'));

        notifySessionPublicLinkInvalidated({ serverId: 'home-one', sessionId: 'session-1' });

        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-retry')).not.toBeNull());
        expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Public link is active');
    });

    it('refreshes from the exact Session change observed during reconnect catch-up', async () => {
        const active = {
            id: 'p-after-reconnect', expiresAt: null, useCount: 0, maxUses: null,
            isConsentRequired: false, updatedAt: 2,
        };
        publication.getPublicLink
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(active);
        const screen = await renderScreen(
            <SessionPublicLinkSection
                scope={scope}
                sessionId="session-1"
                session={session({ managePublicLink: true })}
                availability={hostedAvailability()}
            />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Off'));

        // The canonical changes-page catch-up publishes raw AccountChange entity IDs.
        publishHomeAccountChange('home-one', ['session-1'], { sessionListQueryAffects: true });

        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Public link is active'));
        expect(publication.getPublicLink).toHaveBeenCalledTimes(2);
    });

    it('reconciles remote create, settings, regeneration, and deletion through the owner endpoint', async () => {
        const first = {
            id: 'p1', expiresAt: null, useCount: 0, maxUses: null,
            isConsentRequired: false, updatedAt: 1,
        };
        const changed = { ...first, maxUses: 5, updatedAt: 2 };
        const regenerated = { ...first, id: 'p2', updatedAt: 3 };
        publication.getPublicLink
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(changed)
            .mockResolvedValueOnce(regenerated)
            .mockResolvedValueOnce(null);
        const screen = await renderScreen(
            <SessionPublicLinkSection
                scope={scope}
                sessionId="session-1"
                session={session({ managePublicLink: true })}
                availability={hostedAvailability()}
            />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Off'));

        await act(async () => {
            notifySessionPublicLinkInvalidated({ serverId: 'home-one', sessionId: 'session-1' });
        });
        await vi.waitFor(() => {
            expect(publication.getPublicLink).toHaveBeenCalledTimes(2);
            expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Public link is active');
        });

        await act(async () => {
            notifySessionPublicLinkInvalidated({ serverId: 'home-one', sessionId: 'session-1' });
        });
        await vi.waitFor(() => {
            expect(publication.getPublicLink).toHaveBeenCalledTimes(3);
            // Addressed at the rendered detail text: the row test id resolves to
            // the pressable host, which carries no `detail` prop to assert on.
            expect(String(screen.findByTestId('session-public-link-detail')?.props.children)).toContain('5');
        });

        await act(async () => {
            notifySessionPublicLinkInvalidated({ serverId: 'home-one', sessionId: 'session-1' });
        });
        await vi.waitFor(() => {
            expect(publication.getPublicLink).toHaveBeenCalledTimes(4);
            expect(String(screen.findByTestId('session-public-link-detail')?.props.children)).not.toContain('5');
        });
        await screen.pressByTestIdAsync('session-public-link-row');
        expect(publicationDialog.open.mock.calls.at(-1)?.[0].publicShare.id).toBe('p2');

        await act(async () => {
            notifySessionPublicLinkInvalidated({ serverId: 'home-one', sessionId: 'session-1' });
        });
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-status')?.props.children).toBe('Off'));
        expect(publication.getPublicLink).toHaveBeenCalledTimes(5);
    });

    // The approval-routed publication journey runs on the real approval
    // lifecycle in `SessionPublicLinkSection.approval.test.tsx`.
});
