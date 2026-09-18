import { describe, expect, it } from 'vitest';
import { accountSettingsParse } from '@happier-dev/protocol';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { localSettingsParse } from '@/sync/domains/settings/localSettings';
import type { Session } from '@/sync/domains/state/storageTypes';

import { buildActivityOverviewFromSource } from '../source/buildActivityOverviewFromSource';
import type { ActivityAttentionSource } from '../source/activityAttentionSourceTypes';
import { resolveActivitySurfaceDeliveryAdmission } from './resolveActivitySurfaceDeliveryAdmission';
import type { ExactHomeAccountSettingsResolver } from './useExactHomeAccountSettings';

const NOW = new Date('2026-05-03T12:00:00.000Z');
const HOME_A = 'server-a';
const HOME_B = 'server-b';
/** The same Session ID on both Homes: admission must never collapse the two. */
const SHARED_SESSION_ID = 'shared-session';
const B_ONLY_SESSION_ID = 'session-b-only';

function createHomeSession(serverId: string, sessionId: string, attention: boolean): Session {
    return createSessionFixture({
        id: sessionId,
        serverId,
        active: true,
        updatedAt: 1_000,
        ...(attention
            ? {
                pendingPermissionRequestCount: 1,
                pendingRequestObservedAt: 950,
                pendingVersion: 1,
                agentState: {
                    controlledByUser: null,
                    requests: {
                        'permission-1': {
                            tool: 'Bash',
                            kind: 'permission',
                            arguments: {},
                            createdAt: 950,
                        },
                    },
                },
            }
            : {}),
    } as Partial<Session>);
}

function createTwoHomeSource(): ActivityAttentionSource {
    const sessions: ReadonlyArray<Readonly<{ serverId: string; session: Session }>> = [
        // Attention lives only on Home B. Home A stays quiet so a leak is visible.
        { serverId: HOME_A, session: createHomeSession(HOME_A, SHARED_SESSION_ID, false) },
        { serverId: HOME_B, session: createHomeSession(HOME_B, SHARED_SESSION_ID, true) },
        { serverId: HOME_B, session: createHomeSession(HOME_B, B_ONLY_SESSION_ID, true) },
    ];
    const sessionListRowsByServerId: Record<string, Record<string, ReturnType<typeof buildSessionListRenderableFromSession>>> = {};
    const ordinarySessionListMembershipByServerId: Record<string, string[]> = {};
    const sessionListIndexByServerId: Record<string, Array<{ type: 'session'; sessionId: string; serverId: string }>> = {};
    for (const { serverId, session } of sessions) {
        (sessionListRowsByServerId[serverId] ??= {})[session.id] = buildSessionListRenderableFromSession(session);
        (ordinarySessionListMembershipByServerId[serverId] ??= []).push(session.id);
        (sessionListIndexByServerId[serverId] ??= []).push({
            type: 'session',
            sessionId: session.id,
            serverId,
        });
    }

    return {
        isDataReady: true,
        // Only Home B's copy is hydrated; the shared ID must still resolve per Home.
        sessionsById: Object.fromEntries(sessions
            .filter(({ serverId }) => serverId === HOME_B)
            .map(({ session }) => [session.id, session])),
        sessionListRowsByServerId,
        ordinarySessionListMembershipByServerId,
        sessionListIndexByServerId,
        concurrentSessionListCacheByServerId: {},
        activeServerId: HOME_B,
        activeServer: { serverId: HOME_B, serverUrl: 'https://home-b.example', generation: 1 },
    } as ActivityAttentionSource;
}

function createResolver(
    settingsByServerId: Readonly<Record<string, Record<string, unknown>>>,
): ExactHomeAccountSettingsResolver {
    return (serverId) => {
        const raw = typeof serverId === 'string' ? settingsByServerId[serverId.trim()] : undefined;
        return raw ? accountSettingsParse(raw) : null;
    };
}

function candidateAddresses(candidates: ReturnType<typeof buildActivityOverviewFromSource>['candidates']) {
    return candidates.map((candidate) => `${candidate.serverId ?? ''}/${candidate.sessionId}`).sort();
}

const LOCAL_SETTINGS = localSettingsParse({});

describe('resolveActivitySurfaceDeliveryAdmission', () => {
    const overview = buildActivityOverviewFromSource({
        source: createTwoHomeSource(),
        nowMs: NOW.getTime(),
        activityName: 'HappierFocusLiveActivity',
    });

    it('builds both Homes as candidates before delivery policy is applied', () => {
        expect(candidateAddresses(overview.candidates)).toEqual([
            `${HOME_A}/${SHARED_SESSION_ID}`,
            `${HOME_B}/${B_ONLY_SESSION_ID}`,
            `${HOME_B}/${SHARED_SESSION_ID}`,
        ]);
    });

    it('admits and projects privacy per originating Home with inverse Account policies', () => {
        const resolveAccountSettings = createResolver({
            // Home A disabled Live Activities but allows full previews on widgets.
            [HOME_A]: {
                attentionDeliveryPolicyV1: {
                    v: 1,
                    channels: { live_activity: { enabled: false } },
                    privacy: { surfaces: { home_widget: 'include_preview' } },
                },
            },
            // Home B is the mirror image. Its Live Activity privacy is stated at the
            // event level because the canonical owner deliberately lets an explicit
            // request-preview rule outrank a surface default.
            [HOME_B]: {
                attentionDeliveryPolicyV1: {
                    v: 1,
                    channels: { home_widget: { enabled: false } },
                    // Stated at both levels: the canonical owner lets an explicit
                    // request-preview rule outrank a surface default, and the surface
                    // default still governs this Home's non-request candidates.
                    events: { permission_request: { previewBehavior: 'status_only' } },
                    privacy: { surfaces: { live_activity: 'status_only', home_widget: 'include_preview' } },
                },
            },
        });

        const liveActivity = resolveActivitySurfaceDeliveryAdmission({
            candidates: overview.candidates,
            surface: 'live_activity',
            resolveAccountSettings,
            localSettings: LOCAL_SETTINGS,
            now: NOW,
        });
        const homeWidget = resolveActivitySurfaceDeliveryAdmission({
            candidates: overview.candidates,
            surface: 'home_widget',
            resolveAccountSettings,
            localSettings: LOCAL_SETTINGS,
            now: NOW,
        });

        expect(candidateAddresses(liveActivity.candidates)).toEqual([
            `${HOME_B}/${B_ONLY_SESSION_ID}`,
            `${HOME_B}/${SHARED_SESSION_ID}`,
        ]);
        expect(candidateAddresses(homeWidget.candidates)).toEqual([`${HOME_A}/${SHARED_SESSION_ID}`]);
        for (const candidate of liveActivity.candidates) {
            expect(liveActivity.privacyModeFor(candidate)).toBe('status_only');
        }
        expect(homeWidget.privacyModeFor(homeWidget.candidates[0]!)).toBe('include_preview');
    });

    it('leaves one Home unchanged when the other Home rewrites its Account policy', () => {
        const bPolicy = {
            attentionDeliveryPolicyV1: {
                v: 1,
                events: { permission_request: { previewBehavior: 'title_only' } },
                privacy: { surfaces: { live_activity: 'title_only' } },
            },
        };
        const readHomeB = (aPolicy: Record<string, unknown>) => {
            const admission = resolveActivitySurfaceDeliveryAdmission({
                candidates: overview.candidates,
                surface: 'live_activity',
                resolveAccountSettings: createResolver({ [HOME_A]: aPolicy, [HOME_B]: bPolicy }),
                localSettings: LOCAL_SETTINGS,
                now: NOW,
            });
            const homeBCandidates = admission.candidates.filter((candidate) => candidate.serverId === HOME_B);
            return homeBCandidates.map((candidate) => admission.privacyModeFor(candidate));
        };

        expect(readHomeB({})).toEqual(['title_only', 'title_only']);
        expect(readHomeB({
            attentionDeliveryPolicyV1: {
                v: 1,
                channels: { live_activity: { enabled: false } },
                events: { permission_request: { previewBehavior: 'include_preview' } },
                privacy: { surfaces: { live_activity: 'include_preview' } },
            },
        })).toEqual(['title_only', 'title_only']);
    });

    it('fails closed for a Home with no resolvable Account settings', () => {
        const admission = resolveActivitySurfaceDeliveryAdmission({
            candidates: overview.candidates,
            surface: 'live_activity',
            resolveAccountSettings: createResolver({ [HOME_B]: {} }),
            localSettings: LOCAL_SETTINGS,
            now: NOW,
        });

        expect(candidateAddresses(admission.candidates)).toEqual([
            `${HOME_B}/${B_ONLY_SESSION_ID}`,
            `${HOME_B}/${SHARED_SESSION_ID}`,
        ]);
        const homeACandidate = overview.candidates.find((candidate) => candidate.serverId === HOME_A);
        expect(admission.privacyModeFor(homeACandidate!)).toBeNull();
    });

    it('suppresses a Home whose Account quiet hours suppress the surface', () => {
        const quietHours = {
            attentionDeliveryPolicyV1: {
                v: 1,
                quietHours: {
                    enabled: true,
                    timezone: 'UTC',
                    windows: [{ startLocalTime: '08:00', endLocalTime: '20:00' }],
                },
                channels: { home_widget: { quietHoursBehavior: 'suppress' } },
            },
        };
        const admission = resolveActivitySurfaceDeliveryAdmission({
            candidates: overview.candidates,
            surface: 'home_widget',
            resolveAccountSettings: createResolver({ [HOME_A]: {}, [HOME_B]: quietHours }),
            localSettings: LOCAL_SETTINGS,
            now: NOW,
        });

        expect(candidateAddresses(admission.candidates)).toEqual([`${HOME_A}/${SHARED_SESSION_ID}`]);
    });

    it('lets a device privacy override narrow every Home Account policy', () => {
        const admission = resolveActivitySurfaceDeliveryAdmission({
            candidates: overview.candidates,
            surface: 'live_activity',
            resolveAccountSettings: createResolver({
                [HOME_A]: { attentionDeliveryPolicyV1: { v: 1, privacy: { surfaces: { live_activity: 'include_preview' } } } },
                [HOME_B]: { attentionDeliveryPolicyV1: { v: 1, privacy: { surfaces: { live_activity: 'include_preview' } } } },
            }),
            localSettings: localSettingsParse({
                attentionDeviceOverridesV1: { v: 1, liveActivities: { privacyMode: 'status_only' } },
            }),
            now: NOW,
        });

        expect(admission.candidates.length).toBe(3);
        for (const candidate of admission.candidates) {
            expect(admission.privacyModeFor(candidate)).toBe('status_only');
        }
    });
});
