import {
    ACTIVITY_REMOTE_ALERT_POLICY_EVENT_V1,
    PUSH_NOTIFICATION_CATEGORY_IDS,
} from '@happier-dev/protocol';

import { localSettingsParse, type LocalSettings } from '@/sync/domains/settings/localSettings';
import { resolveServerCredentialAccountScope } from '@/sync/domains/scope/serverCredentialAccountScope';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import type { ActivityAttentionDeliveryChannel, ActivityAttentionDeliveryEventKind } from '../delivery/activityAttentionDeliveryPlanTypes';
import { readExactHomeAccountSettings } from '../delivery/useExactHomeAccountSettings';
import { resolveActivityAttentionDeliveryPlan } from '../delivery/resolveActivityAttentionDeliveryPlan';
import { noteActivityAlertPresented } from './remoteAlerts/activityAlertPresentationNotes';
import { resolveRemoteAlertForegroundPresentation } from './remoteAlerts/resolveRemoteAlertForegroundPresentation';
import { resolveNotificationSavedHome } from './resolveNotificationSavedHome';

export type ForegroundNotificationBehavior = 'full' | 'silent' | 'off';

type ForegroundNotificationArrival = Readonly<{
    serverId: string;
    sessionId: string | null;
    event: ActivityAttentionDeliveryEventKind;
    channel: ActivityAttentionDeliveryChannel;
}>;

function readTrimmedString(record: Readonly<Record<string, unknown>>, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** A request notification carries its kind as the native category both producers set. */
function readArrivalEvent(categoryIdentifier: unknown): ActivityAttentionDeliveryEventKind {
    if (categoryIdentifier === PUSH_NOTIFICATION_CATEGORY_IDS.permissionRequestV1) return 'permission_request';
    if (categoryIdentifier === PUSH_NOTIFICATION_CATEGORY_IDS.userActionRequestV1) return 'user_action_request';
    return 'ready';
}

/**
 * Names a non-Home-alert arrival: its exact Home, event and the channel it
 * actually arrived on.
 *
 * A device-local notification carries the saved Home id this device named when
 * it scheduled it. The daemon rich push names its Home only by client URL
 * (`withServerUrlInPushData`), so it resolves through the saved-Home rule and is
 * judged on the push channel. An arrival whose Home cannot be named exactly
 * fails closed; it is never judged by the focused Home.
 */
function resolveArrival(content: Readonly<{ data?: unknown; categoryIdentifier?: unknown }>): ForegroundNotificationArrival | null {
    const data = content.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const record = data as Readonly<Record<string, unknown>>;
    const sessionId = readTrimmedString(record, 'sessionId');
    const event = readArrivalEvent(content.categoryIdentifier);
    const localServerId = readTrimmedString(record, 'serverId');
    if (localServerId) return { serverId: localServerId, sessionId, event, channel: 'local_notification' };
    const serverUrl = readTrimmedString(record, 'serverUrl');
    const home = serverUrl ? resolveNotificationSavedHome({ serverId: null, serverUrl }) : null;
    return home ? { serverId: home.id, sessionId, event, channel: 'expo_push' } : null;
}

/**
 * How an arriving notification may present while Happier is in the foreground.
 *
 * One owner normalizes every current arrival — a Home remote alert, a device-local
 * notification, or the daemon rich push — into its exact Home, event and arrival
 * channel, suppresses it only while that exact Home Session is visible, and asks
 * the canonical delivery-plan owner. The active Home's Account policy is never a
 * substitute, and a Home whose Account settings this device cannot name fails
 * closed. A presented Home alert is noted so the device's own local leg does not
 * repeat the same committed event.
 */
export async function resolveForegroundNotificationBehavior(params: Readonly<{
    /** The arriving Expo notification content. */
    content: Readonly<{ data?: unknown; categoryIdentifier?: unknown }>;
    localSettings: Partial<LocalSettings> | null | undefined;
    now: Date;
    isSessionVisible: (address: SessionAddress) => boolean;
}>): Promise<ForegroundNotificationBehavior> {
    const remoteAlert = resolveRemoteAlertForegroundPresentation({
        data: params.content.data,
        isSessionVisible: params.isSessionVisible,
    });
    if (remoteAlert.kind === 'suppress') return 'off';
    const target = remoteAlert.kind === 'present' ? remoteAlert.target : null;
    const arrival: ForegroundNotificationArrival | null = target
        ? {
            serverId: target.address.serverId,
            sessionId: target.address.sessionId,
            event: ACTIVITY_REMOTE_ALERT_POLICY_EVENT_V1[target.alert.event.type],
            channel: 'expo_push',
        }
        : resolveArrival(params.content);
    if (!arrival) return 'off';
    // Same-Session suppression is exact-Home: the same Session id visible on
    // another Home never hides this one.
    if (!target && arrival.sessionId && params.isSessionVisible({ serverId: arrival.serverId, sessionId: arrival.sessionId })) {
        return 'off';
    }

    const resolution = await resolveServerCredentialAccountScope(arrival.serverId);
    // A Home alert names its recipient Account. When this device now holds a
    // different Account for that Home, the alert is not this Account's to present.
    if (target && resolution.kind === 'bound' && resolution.scope.accountId !== target.alert.accountId) return 'off';
    const accountSettings = resolution.kind === 'bound'
        ? readExactHomeAccountSettings(resolution.scope)
        : null;
    if (!accountSettings) return 'off';

    const plan = resolveActivityAttentionDeliveryPlan({
        localSettings: localSettingsParse(params.localSettings ?? {}),
        accountSettings,
        event: arrival.event,
        // A push is judged on the push channel: disabling this device's own local
        // notifications must not silence a permitted push, and vice versa.
        channel: arrival.channel,
        foregroundState: 'foreground',
        now: params.now,
    });
    // Quiet hours weaken, never strengthen, the configured foreground behavior.
    const behavior: ForegroundNotificationBehavior = plan.delivery === 'suppress'
        ? 'off'
        : plan.delivery === 'silent' && plan.foregroundBehavior === 'full'
            ? 'silent'
            : plan.foregroundBehavior;
    if (target?.eventIdentity && behavior !== 'off') {
        noteActivityAlertPresented({
            address: target.address,
            event: target.event,
            identity: target.eventIdentity,
            source: 'home_remote_alert',
        });
    }
    return behavior;
}
