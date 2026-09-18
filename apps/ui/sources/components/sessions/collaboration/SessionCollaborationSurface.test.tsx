import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { tryWriteServerEnabledBitInPlace } from '@happier-dev/protocol';

import { pressTestInstance, renderScreen, standardCleanup } from '@/dev/testkit';
import { primeServerFeaturesSnapshot, resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { storage } from '@/sync/domains/state/storage';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { SessionCollaborationSurface } from './SessionCollaborationSurface';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { publishSessionCollaborationIntent, resetSessionCollaborationIntentsForTests } from './sessionCollaborationIntent';

const credentials = vi.hoisted(() => ({ serverId: '', accountId: 'collaboration-account' }));
const exactSessionSnapshot = vi.hoisted(() => ({ read: vi.fn() }));
/** Every request this surface issues, captured at the one runtime transport boundary. */
const transport = vi.hoisted(() => ({
    requests: [] as Array<Readonly<{ origin: string; path: string; method: string; authorization: string | null }>>,
    publicationReachable: true,
}));
const discussions = vi.hoisted(() => ({
    list: vi.fn(async (input?: Readonly<{ state?: 'active' | 'archived' }>) => ({
        kind: 'succeeded' as const,
        value: {
            v: 1 as const,
            serverId: credentials.serverId,
            sessionId: 'same-id',
            discussions: [],
            nextCursor: null,
            incomplete: false,
            state: input?.state ?? 'active',
        },
    })),
}));
const nativeFocus = vi.hoisted(() => ({
    findNodeHandle: vi.fn<(target: unknown) => number | null>(() => null),
    setAccessibilityFocus: vi.fn(),
}));
/** The live URL this surface is mounted under, so a consumed query key is observable. */
const route = vi.hoisted(() => ({
    params: {} as Record<string, string | string[] | undefined>,
    setParams: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    readParams: (() => ({})) as () => Record<string, string | string[] | undefined>,
    applyParams: ((_params: Record<string, string | string[] | undefined>) => undefined) as (params: Record<string, string | string[] | undefined>) => void,
    resetParams: (() => undefined) as () => void,
}));

// The canonical router factory over the repository's own expo-router stub: the
// surface reads route state through it and writes back through the navigation owner.
vi.mock('expo-router', async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>();
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const mock = createExpoRouterMock({
        params: () => route.params,
        router: { setParams: route.setParams, replace: route.replace, push: route.push },
    });
    route.readParams = () => mock.state.params;
    route.applyParams = (params) => { mock.state.router.setParams(params); };
    route.resetParams = mock.resetParams;
    return { ...original, ...mock.module };
});

// Window geometry is the platform boundary that selects the responsive host, and
// the shared native runtime reports an 800x600 window whose 600pt minimum edge is
// exactly the canonical tablet breakpoint. This file is the compact iOS phone
// host, so it supplies real phone geometry through the same canonical factory and
// lets the real `useIsTablet`/`determineDeviceType` owner choose the pushed
// Responsibility step rather than the anchored popover.
const phoneWindow = vi.hoisted(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 }));

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'ios' }, {
        findNodeHandle: nativeFocus.findNodeHandle,
        AccessibilityInfo: { setAccessibilityFocus: nativeFocus.setAccessibilityFocus },
        Dimensions: { get: () => ({ ...phoneWindow }) },
        useWindowDimensions: () => ({ ...phoneWindow }),
    });
});

// The recycler is a platform boundary: its real implementation schedules on
// `requestAnimationFrame`, which this native runner does not provide, so the
// canonical testkit recycler stands in while every list, selection and
// pagination decision above it stays real.
vi.mock('@legendapp/list/react-native', async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>();
    const { createCapturingLegendListMock } = await import('@/dev/testkit');
    return createCapturingLegendListMock({ original, renderItems: true, renderItemLimit: 20 }).module;
});

// The exact scoped Session reader is the orchestration boundary consumed by
// Collaboration. Its own tests prove the HTTP/decryption path; this test proves
// that the surface requests and renders the bound Home rather than the active
// global Session with the same raw id.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/readSessionSnapshotForAuthority', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/runtime/orchestration/serverScopedRpc/readSessionSnapshotForAuthority')>()),
    readSessionSnapshotForAuthority: exactSessionSnapshot.read,
}));

// HTTP is the replaced boundary. The repository, retained pane state, and
// active/archive projections remain real in this component integration test.
vi.mock('@/sync/api/session/sessionDiscussionActions', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/api/session/sessionDiscussionActions')>()),
    createSessionDiscussionClient: () => ({
        list: discussions.list,
        get: vi.fn(),
        read: vi.fn(),
        create: vi.fn(),
        post: vi.fn(),
        rename: vi.fn(),
        archive: vi.fn(),
        restore: vi.fn(),
        readState: vi.fn(),
    }),
}));

/** The persisted credential this Home would hand to the transport, Account subject included. */
function credentialTokenFor(accountId: string): string {
    return `header.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64')}.signature`;
}

// Device credential storage is the boundary; scope resolution and Session projections remain real.
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            getCredentialsForServerUrl: async (_url, options) => options?.serverId === credentials.serverId ? {
                token: `header.${Buffer.from(JSON.stringify({ sub: credentials.accountId })).toString('base64')}.signature`,
            } : null,
        },
    });
});

afterEach(() => {
    standardCleanup();
    storage.setState(storage.getInitialState(), true);
    resetServerFeaturesClientForTests();
    resetSessionCollaborationIntentsForTests();
    resetRuntimeFetch();
    vi.clearAllMocks();
    nativeFocus.findNodeHandle.mockReset();
    nativeFocus.setAccessibilityFocus.mockReset();
});

beforeEach(() => {
    transport.requests.length = 0;
    transport.publicationReachable = true;
    route.params = {};
    // This module-level router mock outlives the whole file, and the consumed
    // `collaborationFocus` key each test writes back is an override that would
    // otherwise mask the same key the next test supplies through `params`.
    route.resetParams();
    route.setParams.mockClear();
    route.replace.mockClear();
    route.push.mockClear();
    // HTTP is the one replaced boundary: the mounted surface, its controllers,
    // scope resolution and the released publication projection stay real, so a
    // request can only reach the Home this surface actually bound itself to.
    setRuntimeFetch(async (url, init) => {
        const parsed = new URL(String(url));
        transport.requests.push({
            origin: parsed.origin,
            path: parsed.pathname,
            method: init?.method ?? 'GET',
            authorization: new Headers(init?.headers).get('Authorization'),
        });
        if (parsed.pathname === '/v1/auth/ping') return new Response('{}');
        if (parsed.pathname === '/v2/account/settings') return new Response(JSON.stringify({ content: null, version: 0 }));
        if (parsed.pathname === '/v1/account/encryption') return new Response(JSON.stringify({ mode: 'plain', updatedAt: 1 }));
        if (parsed.pathname.endsWith('/public-share')) {
            return transport.publicationReachable
                ? new Response(JSON.stringify({ publicShare: null }))
                : new Response('{}', { status: 503 });
        }
        // Everything else this surface reaches for is owned by another lane's
        // route and is deliberately unavailable here.
        return new Response('{}', { status: 404 });
    });
});

type CollaborationFeatureId = 'sharing.session' | 'sharing.public' | 'sessions.collaboration' | 'sessions.conversations';

function primeFeatures(
    serverId: string,
    enabled: readonly CollaborationFeatureId[],
    disabled: readonly CollaborationFeatureId[] = [],
): void {
    const features = createRootLayoutFeaturesResponse();
    for (const feature of enabled) {
        if (!tryWriteServerEnabledBitInPlace(features, feature, true)) throw new Error(`Unable to enable ${feature}`);
    }
    for (const feature of disabled) {
        if (!tryWriteServerEnabledBitInPlace(features, feature, false)) throw new Error(`Unable to disable ${feature}`);
    }
    primeServerFeaturesSnapshot({ serverId, snapshot: { status: 'ready', features } });
}

function primeCollaboration(serverId: string): void {
    primeFeatures(serverId, ['sharing.session', 'sharing.public', 'sessions.collaboration', 'sessions.conversations']);
}

describe('SessionCollaborationSurface', () => {
    it('hydrates publication from the exact inactive Home when the active Home has the same raw Session id', async () => {
        const active = await upsertServerProfile({ name: 'Active Home', serverUrl: 'https://collaboration-active-other.example.test' });
        const profile = await upsertServerProfile({ name: 'Collaboration test Home', serverUrl: 'https://collaboration-inactive.example.test' });
        primeCollaboration(profile.id);
        credentials.serverId = profile.id;
        exactSessionSnapshot.read.mockResolvedValue({
            session: {
                id: 'same-id', serverId: profile.id, metadata: null,
                currentStorageState: 'hosted', transcriptShareable: true,
                access: { capabilities: { managePublicLink: true } },
            } as unknown as Session,
            callerDataKeyEnvelope: null,
        });
        const rows = {};
        const index: SessionListIndexItem[] = [];
        storage.setState((state) => ({
            profileScope: { serverId: active.id, accountId: 'active-account' },
            sessions: {
                ...state.sessions,
                'same-id': {
                    id: 'same-id', serverId: active.id, metadata: null,
                    currentStorageState: 'hosted', transcriptShareable: true,
                    access: { capabilities: { managePublicLink: false } },
                } as unknown as Session,
            },
            sessionListRowsByServerId: { ...state.sessionListRowsByServerId, [profile.id]: rows },
            sessionListIndexByServerId: { ...state.sessionListIndexByServerId, [profile.id]: index },
        }));
        publishSessionCollaborationIntent({ serverId: profile.id, sessionId: 'same-id' }, 'publicLink');

        const screen = await renderScreen(
            <AppPaneProvider>
                <SessionCollaborationSurface target={{ serverId: profile.id, sessionId: 'same-id' }} />
            </AppPaneProvider>,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-access-editor:collaboration')).not.toBeNull());
        expect(storage.getState().sessionListRowsByServerId[profile.id]).toBe(rows);
        expect(storage.getState().sessionListIndexByServerId[profile.id]).toBe(index);
        await vi.waitFor(() => expect(exactSessionSnapshot.read).toHaveBeenCalled());
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-row')).not.toBeNull());
        expect(exactSessionSnapshot.read).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'same-id',
            authority: expect.objectContaining({
                scope: expect.objectContaining({ serverId: profile.id, accountId: credentials.accountId }),
            }),
        }));
        // Publication is read from the bound inactive Home with that Home's own
        // credential, never from whichever Home happens to be active.
        const publicationRequests = transport.requests.filter((request) => request.path.endsWith('/public-share'));
        expect(publicationRequests).not.toHaveLength(0);
        for (const request of publicationRequests) {
            expect(request.path).toBe('/v1/sessions/same-id/public-share');
            expect(request.origin).toBe('https://collaboration-inactive.example.test');
            expect(request.authorization).toContain(credentialTokenFor(credentials.accountId));
        }
        expect(transport.requests.some((request) => request.origin === 'https://collaboration-active-other.example.test')).toBe(false);
        expect(active.id).not.toBe(profile.id);
    });

    it('composes publication as an independently failing sibling of the one flexing access body', async () => {
        const active = await upsertServerProfile({ name: 'Collaboration active Home', serverUrl: 'https://collaboration-active.example.test' });
        credentials.serverId = active.id;
        // Released direct access plus publication: named Team/Group collaboration
        // stays off, so Access is the single mode and Public link is still its own sibling.
        primeFeatures(active.id, ['sharing.session', 'sharing.public'], ['sessions.collaboration', 'sessions.conversations']);
        storage.setState((state) => ({
            profileScope: { serverId: active.id, accountId: credentials.accountId },
            sessions: {
                ...state.sessions,
                'same-id': {
                    id: 'same-id', metadata: null, currentStorageState: 'hosted', transcriptShareable: true,
                    access: { capabilities: { managePublicLink: true } },
                } as unknown as Session,
            },
        }));
        exactSessionSnapshot.read.mockResolvedValue({
            session: storage.getState().sessions['same-id'],
            callerDataKeyEnvelope: null,
        });
        transport.publicationReachable = false;

        const screen = await renderScreen(
            <AppPaneProvider>
                <SessionCollaborationSurface target={{ serverId: active.id, sessionId: 'same-id' }} />
            </AppPaneProvider>,
        );
        // One access editor, mounted as the surface's only vertical scroll owner.
        await vi.waitFor(() => expect(screen.findByTestId('session-access-editor:collaboration')).not.toBeNull());
        // Publication is a sibling section with its own failure boundary: an
        // unreachable publication read shows a section-local retry and leaves the
        // access body rendered.
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-retry')).not.toBeNull());
        expect(screen.findByTestId('session-access-editor:collaboration')).not.toBeNull();
        expect(screen.findByTestId('session-collaboration-access-body')?.props.style).toMatchObject({ flex: 1, minHeight: 0 });
    });

    it('pushes the compact Responsibility step in place of the retained Collaboration body', async () => {
        const active = await upsertServerProfile({ name: 'Responsibility step Home', serverUrl: 'https://collaboration-responsibility-step.example.test' });
        credentials.serverId = active.id;
        primeCollaboration(active.id);
        const responsibilitySession = {
            id: 'same-id', metadata: null, currentStorageState: 'hosted', transcriptShareable: true,
            // `null` is an authoritative "nobody", so responsibility is
            // projected and this viewer may change it.
            responsibleAccountId: null,
            responsibleAccount: null,
            access: { capabilities: { managePublicLink: true, assignResponsibility: true } },
        } as unknown as Session;
        storage.setState((state) => ({
            profileScope: { serverId: active.id, accountId: credentials.accountId },
            sessions: { ...state.sessions, 'same-id': responsibilitySession },
            // Responsibility's canonical reader is the exact Home's Session list
            // row, not the unscoped Session record, so the mounted controller
            // only leaves `loading` once that row exists for this Home.
            sessionListRowsByServerId: {
                ...state.sessionListRowsByServerId,
                [active.id]: { 'same-id': responsibilitySession } as unknown as Record<string, SessionListRenderableSession>,
            },
        }));
        exactSessionSnapshot.read.mockResolvedValue({
            session: responsibilitySession,
            callerDataKeyEnvelope: null,
        });
        // Enter through an Access-labelled affordance, so the body that has to
        // survive the pushed step is the Access editor asserted below rather
        // than the default Conversations mode.
        publishSessionCollaborationIntent({ serverId: active.id, sessionId: 'same-id' }, 'access');

        const screen = await renderScreen(
            <AppPaneProvider>
                <SessionCollaborationSurface target={{ serverId: active.id, sessionId: 'same-id' }} />
            </AppPaneProvider>,
        );
        // This file mounts an iOS phone, so the compact host is the live one.
        await vi.waitFor(() => expect(screen.findByTestId('session-responsibility-row')).not.toBeNull());
        expect(screen.findByTestId('session-collaboration-main-panel')?.props.pointerEvents).toBe('auto');

        await screen.pressByTestIdAsync('session-responsibility-row');
        await vi.waitFor(() => expect(screen.findByTestId('session-responsibility-step')).not.toBeNull());

        // The transition belongs to the surface, not to an overlay above it:
        // Collaboration's own body stops being interactive and is hidden from
        // assistive technology while the step occupies the surface. A modal card
        // containing the same list would have left this panel active, which is
        // why asserting the step's descendants alone cannot prove a pushed step.
        const duringStep = screen.findByTestId('session-collaboration-main-panel');
        expect(duringStep?.props.pointerEvents).toBe('none');
        expect(duringStep?.props.importantForAccessibility).toBe('no-hide-descendants');
        expect(duringStep?.props.accessibilityElementsHidden).toBe(true);
        // Retained rather than unmounted, so Access scroll, drafts and focus
        // survive the round trip instead of reloading behind the step.
        expect(screen.findByTestId('session-access-editor:collaboration')).not.toBeNull();

        await screen.pressByTestIdAsync('session-responsibility-step-back');

        await vi.waitFor(() => expect(screen.findByTestId('session-responsibility-step')).toBeNull());
        const afterBack = screen.findByTestId('session-collaboration-main-panel');
        expect(afterBack?.props.pointerEvents).toBe('auto');
        expect(afterBack?.props.accessibilityElementsHidden).toBe(false);
        expect(screen.findByTestId('session-responsibility-row')).not.toBeNull();
    });

    it('keeps publication reachable on a Home that publishes links but does not support named access', async () => {
        const active = await upsertServerProfile({ name: 'Publication only Home', serverUrl: 'https://collaboration-publication-only.example.test' });
        credentials.serverId = active.id;
        // `sharing.public` has no catalog dependency on `sharing.session`, so this
        // Home is reachable. The destination must stay admitted: publication has
        // no other entry point, and the named-access body states why it is absent
        // instead of rendering an editor that cannot work.
        primeFeatures(active.id, ['sharing.public'], ['sharing.session', 'sessions.collaboration', 'sessions.conversations']);
        storage.setState((state) => ({
            profileScope: { serverId: active.id, accountId: credentials.accountId },
            sessions: {
                ...state.sessions,
                'same-id': {
                    id: 'same-id', metadata: null, currentStorageState: 'hosted', transcriptShareable: true,
                    access: { capabilities: { managePublicLink: true } },
                } as unknown as Session,
            },
        }));
        exactSessionSnapshot.read.mockResolvedValue({
            session: storage.getState().sessions['same-id'],
            callerDataKeyEnvelope: null,
        });

        const screen = await renderScreen(
            <AppPaneProvider>
                <SessionCollaborationSurface target={{ serverId: active.id, sessionId: 'same-id' }} />
            </AppPaneProvider>,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-named-access-unavailable')).not.toBeNull());
        expect(screen.findByTestId('session-access-editor:collaboration')).toBeNull();
        await vi.waitFor(() => expect(screen.findByTestId('session-public-link-row')).not.toBeNull());
    });

    it('drops a visited Conversations body once the exact Home withdraws that feature', async () => {
        const active = await upsertServerProfile({ name: 'Conversations withdrawn Home', serverUrl: 'https://collaboration-conversations-withdrawn.example.test' });
        credentials.serverId = active.id;
        primeCollaboration(active.id);
        storage.setState((state) => ({
            profileScope: { serverId: active.id, accountId: credentials.accountId },
            sessions: {
                ...state.sessions,
                'same-id': {
                    id: 'same-id', metadata: null, currentStorageState: 'hosted', transcriptShareable: true,
                    access: { capabilities: { managePublicLink: false } },
                } as unknown as Session,
            },
        }));
        exactSessionSnapshot.read.mockResolvedValue({
            session: storage.getState().sessions['same-id'],
            callerDataKeyEnvelope: null,
        });

        const screen = await renderScreen(
            <AppPaneProvider>
                <SessionCollaborationSurface target={{ serverId: active.id, sessionId: 'same-id' }} />
            </AppPaneProvider>,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-conversations-panel')).not.toBeNull());

        // The Home stops advertising the dependent feature while this surface
        // stays mounted. Retention is for a supported mode the user may return
        // to; an unsupported one must fail closed rather than stay mounted,
        // subscribed and reachable to assistive technology behind a mode
        // selector that no longer offers it.
        await act(async () => {
            primeFeatures(
                active.id,
                ['sharing.session', 'sharing.public', 'sessions.collaboration'],
                ['sessions.conversations'],
            );
        });

        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-conversations-panel')).toBeNull());
        expect(screen.findByTestId('session-collaboration-modes')).toBeNull();
        await vi.waitFor(() => expect(screen.findByTestId('session-access-editor:collaboration')).not.toBeNull());
    });

    it('applies explicit Access intent on the first mount and retains both visited mode bodies inertly', async () => {
        const active = await upsertServerProfile({ name: 'Collaboration modes Home', serverUrl: 'https://collaboration-modes.example.test' });
        credentials.serverId = active.id;
        primeCollaboration(active.id);
        storage.setState((state) => ({
            profileScope: { serverId: active.id, accountId: credentials.accountId },
            sessions: {
                ...state.sessions,
                'same-id': {
                    id: 'same-id', metadata: null, currentStorageState: 'hosted', transcriptShareable: true,
                    access: { capabilities: { managePublicLink: false } },
                } as unknown as Session,
            },
        }));
        exactSessionSnapshot.read.mockResolvedValue({
            session: storage.getState().sessions['same-id'],
            callerDataKeyEnvelope: null,
        });
        publishSessionCollaborationIntent({ serverId: active.id, sessionId: 'same-id' }, 'access');

        const screen = await renderScreen(
            <AppPaneProvider>
                <SessionCollaborationSurface target={{ serverId: active.id, sessionId: 'same-id' }} />
            </AppPaneProvider>,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-access-editor:collaboration')).not.toBeNull());
        expect(screen.findByTestId('session-collaboration-mode:access')?.props.accessibilityState).toMatchObject({ selected: true });
        expect(screen.findByTestId('session-collaboration-conversations-panel')).toBeNull();

        await act(async () => {
            pressTestInstance(screen.findByTestId('session-collaboration-mode:conversations'));
        });
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-mode:conversations')?.props.accessibilityState).toMatchObject({ selected: true }));
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-conversations-panel')).not.toBeNull());
        await vi.waitFor(() => expect(screen.findByTestId('session-discussion-activity-list')).not.toBeNull());

        await act(async () => {
            pressTestInstance(screen.findByTestId('session-collaboration-mode:access'));
        });
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-conversations-panel')?.props).toMatchObject({
            pointerEvents: 'none',
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants',
        }));

        await act(async () => {
            pressTestInstance(screen.findByTestId('session-collaboration-mode:conversations'));
        });
        await vi.waitFor(() => expect(screen.findByTestId('session-discussion-activity-list')).not.toBeNull());
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-access-panel')?.props).toMatchObject({
            pointerEvents: 'none',
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants',
        }));
    });

    it('focuses the requested anchor when an already-mounted surface consumes a new intent', async () => {
        const active = await upsertServerProfile({ name: 'Collaboration focus Home', serverUrl: 'https://collaboration-focus.example.test' });
        credentials.serverId = active.id;
        primeCollaboration(active.id);
        storage.setState((state) => ({
            profileScope: { serverId: active.id, accountId: credentials.accountId },
            sessions: {
                ...state.sessions,
                'same-id': {
                    id: 'same-id', metadata: null, currentStorageState: 'hosted', transcriptShareable: true,
                    access: { capabilities: { managePublicLink: false } },
                } as unknown as Session,
            },
        }));
        exactSessionSnapshot.read.mockResolvedValue({
            session: storage.getState().sessions['same-id'],
            callerDataKeyEnvelope: null,
        });
        const focused = vi.fn();
        const nativeNodes = new Map<string, Readonly<{ id: number }>>();
        nativeFocus.findNodeHandle.mockImplementation((target) => (
            [...nativeNodes.values()].find((node) => node === target)?.id ?? null
        ));

        const screen = await renderScreen(
            <AppPaneProvider>
                <SessionCollaborationSurface target={{ serverId: active.id, sessionId: 'same-id' }} />
            </AppPaneProvider>,
            {
                createNodeMock: (element) => {
                    const testID = (element as { props?: { testID?: string } }).props?.testID;
                    const node = { id: nativeNodes.size + 1, focus: () => focused(testID) };
                    if (testID) nativeNodes.set(testID, node);
                    return node;
                },
            },
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-conversations-panel')).not.toBeNull());
        await vi.waitFor(() => expect(screen.findByTestId('session-discussion-activity-list')).not.toBeNull());

        await act(async () => {
            publishSessionCollaborationIntent({ serverId: active.id, sessionId: 'same-id' }, 'access');
        });

        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-mode:access')?.props.accessibilityState).toMatchObject({ selected: true }));
        await vi.waitFor(() => expect(focused).toHaveBeenCalledWith('session-collaboration-access-body'));
        await vi.waitFor(() => expect(nativeFocus.setAccessibilityFocus).toHaveBeenCalledWith(
            nativeNodes.get('session-collaboration-access-body')?.id,
        ));

        await act(async () => {
            publishSessionCollaborationIntent({ serverId: active.id, sessionId: 'same-id' }, 'publicLink');
        });
        await vi.waitFor(() => expect(nativeFocus.setAccessibilityFocus).toHaveBeenLastCalledWith(
            nativeNodes.get('session-collaboration-public-link-anchor')?.id,
        ));

        nativeFocus.setAccessibilityFocus.mockClear();
        await act(async () => {
            publishSessionCollaborationIntent({ serverId: active.id, sessionId: 'same-id' }, 'access');
            publishSessionCollaborationIntent({ serverId: active.id, sessionId: 'same-id' }, 'publicLink');
        });
        await vi.waitFor(() => expect(nativeFocus.setAccessibilityFocus).toHaveBeenCalledWith(
            nativeNodes.get('session-collaboration-public-link-anchor')?.id,
        ));
        expect(nativeFocus.setAccessibilityFocus).not.toHaveBeenCalledWith(
            nativeNodes.get('session-collaboration-access-body')?.id,
        );

        nativeFocus.setAccessibilityFocus.mockClear();
        await screen.unmount();
        publishSessionCollaborationIntent({ serverId: active.id, sessionId: 'same-id' }, 'access');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(nativeFocus.setAccessibilityFocus).not.toHaveBeenCalled();
    });

    it('consumes the Access focus query once so a later visit keeps the mode the user chose', async () => {
        const active = await upsertServerProfile({ name: 'Collaboration query Home', serverUrl: 'https://collaboration-query.example.test' });
        credentials.serverId = active.id;
        primeCollaboration(active.id);
        storage.setState((state) => ({
            profileScope: { serverId: active.id, accountId: credentials.accountId },
            sessions: {
                ...state.sessions,
                'same-id': {
                    id: 'same-id', metadata: null, currentStorageState: 'hosted', transcriptShareable: true,
                    access: { capabilities: { managePublicLink: false } },
                } as unknown as Session,
            },
        }));
        exactSessionSnapshot.read.mockResolvedValue({
            session: storage.getState().sessions['same-id'],
            callerDataKeyEnvelope: null,
        });
        // A released Access deep link: the one-shot intent travels as a query key
        // beside the Session's own exact-Home route state.
        route.params = { serverId: active.id, collaborationFocus: 'access' };

        const target = { serverId: active.id, sessionId: 'same-id' };
        const screen = await renderScreen(
            <AppPaneProvider>
                <SessionCollaborationSurface target={target} />
            </AppPaneProvider>,
        );
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-mode:access')?.props.accessibilityState)
            .toMatchObject({ selected: true }));

        // Applied once, then consumed at the navigation owner: only this key is
        // rewritten, the Session's own route scope survives, and nothing navigates.
        await vi.waitFor(() => expect(route.setParams).toHaveBeenCalledWith({ collaborationFocus: undefined }));
        expect(route.readParams()).toMatchObject({ serverId: active.id });
        expect(route.readParams().collaborationFocus).toBeUndefined();
        expect(route.replace).not.toHaveBeenCalled();
        expect(route.push).not.toHaveBeenCalled();

        await act(async () => {
            pressTestInstance(screen.findByTestId('session-collaboration-mode:conversations'));
        });
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-mode:conversations')?.props.accessibilityState)
            .toMatchObject({ selected: true }));

        // Leaving and returning to the same Session must not force Access again.
        await screen.unmount();
        const revisited = await renderScreen(
            <AppPaneProvider>
                <SessionCollaborationSurface target={target} />
            </AppPaneProvider>,
        );
        await vi.waitFor(() => expect(revisited.findByTestId('session-collaboration-mode:conversations')?.props.accessibilityState)
            .toMatchObject({ selected: true }));
        expect(revisited.findByTestId('session-collaboration-mode:access')?.props.accessibilityState)
            .toMatchObject({ selected: false });
    });

    it('handles the same route focus again after the canonical intent was absent without remounting', async () => {
        const active = await upsertServerProfile({ name: 'Collaboration repeated query Home', serverUrl: 'https://collaboration-repeated-query.example.test' });
        credentials.serverId = active.id;
        primeCollaboration(active.id);
        storage.setState((state) => ({
            profileScope: { serverId: active.id, accountId: credentials.accountId },
            sessions: {
                ...state.sessions,
                'same-id': {
                    id: 'same-id', metadata: null, currentStorageState: 'hosted', transcriptShareable: true,
                    access: { capabilities: { managePublicLink: false } },
                } as unknown as Session,
            },
        }));
        exactSessionSnapshot.read.mockResolvedValue({
            session: storage.getState().sessions['same-id'],
            callerDataKeyEnvelope: null,
        });
        route.params = { serverId: active.id, collaborationFocus: 'access' };
        const target = { serverId: active.id, sessionId: 'same-id' };
        const focused = vi.fn();

        // Rendered fresh on every pass: React bails out of a subtree whose
        // element is referentially identical, so reusing one cached element
        // would leave the surface on its previous route read and this test
        // could never observe a second query arriving at all.
        const element = () => (
            <AppPaneProvider>
                <SessionCollaborationSurface target={target} />
            </AppPaneProvider>
        );
        const screen = await renderScreen(element(), {
            createNodeMock: (node) => {
                const testID = (node as { props?: { testID?: string } }).props?.testID;
                return { focus: () => focused(testID) };
            },
        });
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-mode:access')?.props.accessibilityState)
            .toMatchObject({ selected: true }));
        await vi.waitFor(() => expect(route.readParams().collaborationFocus).toBeUndefined());

        await act(async () => {
            pressTestInstance(screen.findByTestId('session-collaboration-mode:conversations'));
        });
        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-mode:conversations')?.props.accessibilityState)
            .toMatchObject({ selected: true }));

        // The route mailbox observed the consumed/absent state before a later
        // caller issued the same exact request again on this retained surface.
        await screen.update(element());
        focused.mockClear();
        await act(async () => { route.applyParams({ collaborationFocus: 'access' }); });
        await screen.update(element());

        await vi.waitFor(() => expect(screen.findByTestId('session-collaboration-mode:access')?.props.accessibilityState)
            .toMatchObject({ selected: true }));
        await vi.waitFor(() => expect(focused).toHaveBeenCalledWith('session-collaboration-access-body'));
        await vi.waitFor(() => expect(route.readParams().collaborationFocus).toBeUndefined());
    });

});
