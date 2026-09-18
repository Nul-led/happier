import {
    resolveActivitySurfacePolicy,
    type ActivitySurfacePolicy,
    type ActivitySurfacePrivacyMode,
} from '@/activity/attention/resolveActivitySurfacePolicy';
import { AttentionDeviceOverridesV1Schema } from '@/sync/domains/settings/attentionDeviceOverridesV1';

type IosActivitySurfacePrivacyOverride = ActivitySurfacePrivacyMode | 'account';

export type IosActivitySurfacePolicies = Readonly<{
    liveActivityPolicy: ActivitySurfacePolicy;
    widgetPolicy: ActivitySurfacePolicy;
}>;

type LocalSettingsLike = Readonly<Record<string, unknown>>;

/**
 * Device-global surface policy only.
 *
 * `privacyMode` here is the device override plus a fail-closed fallback: the
 * privacy a rendered card actually uses comes from its own Home's Account
 * delivery plan, resolved per candidate before presentation. A candidate with no
 * resolvable exact-Home plan is never presented, so this fallback discloses
 * nothing.
 */
function resolvePrivacyMode(override: IosActivitySurfacePrivacyOverride): ActivitySurfacePrivacyMode {
    return override === 'account' ? 'status_only' : override;
}

export function resolveIosActivitySurfacePolicies(params: Readonly<{
    localSettings: LocalSettingsLike;
}>): IosActivitySurfacePolicies {
    const basePolicy = resolveActivitySurfacePolicy(params.localSettings);
    const deviceOverrides = AttentionDeviceOverridesV1Schema.parse(
        params.localSettings.attentionDeviceOverridesV1,
    );

    return {
        liveActivityPolicy: {
            ...basePolicy,
            privacyMode: resolvePrivacyMode(deviceOverrides.liveActivities.privacyMode),
        },
        widgetPolicy: {
            ...basePolicy,
            privacyMode: resolvePrivacyMode(deviceOverrides.widgets.privacyMode),
        },
    };
}
