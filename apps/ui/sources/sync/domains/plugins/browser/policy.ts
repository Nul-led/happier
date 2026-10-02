import {
    evaluatePluginUiPolicy,
    type PluginUiPolicyEvaluationContext,
} from '@/sync/domains/plugins/ui/policy/evaluate';
import { resolvePluginLocalizedText, type PluginLocalizedTextResolver } from '@/sync/domains/plugins/ui/i18n';
import type { PluginBrowserProjectionEntry } from './targets';

export type PluginBrowserPolicyDecision = Readonly<{
    visible: boolean;
    enabled: boolean;
    unavailableReason: string | null;
}>;

/**
 * Canonical render/use gate for a plugin browser projection entry. Shares the
 * canonical contribution availability evaluator with plugin-UI surfaces.
 *
 * The context is optional so the existing pure callers keep working; gating
 * signals that REQUIRE a resolver fail closed when none is supplied.
 */
export function canUsePluginBrowserProjectionEntry(
    entry: PluginBrowserProjectionEntry | null | undefined,
    ctx: PluginUiPolicyEvaluationContext = {},
): boolean {
    const decision = resolvePluginBrowserPolicyDecision(entry, ctx);
    return decision.visible && decision.enabled;
}

function readLocalizedText(
    value: unknown,
    pluginId: string,
    localize?: PluginLocalizedTextResolver,
): string | null {
    const resolved = localize?.(pluginId, value) ?? resolvePluginLocalizedText({
        projection: null,
        pluginId,
        value,
    });
    const normalized = resolved.trim();
    return normalized.length > 0 ? normalized : null;
}

/**
 * Browser presentation policy preserves the shared evaluator's visible/enabled split. Disabled
 * entries remain visible and expose the author-supplied reason; hidden entries remain absent.
 */
export function resolvePluginBrowserPolicyDecision(
    entry: PluginBrowserProjectionEntry | null | undefined,
    ctx: PluginUiPolicyEvaluationContext = {},
    localize?: PluginLocalizedTextResolver,
): PluginBrowserPolicyDecision {
    if (!entry) {
        return { visible: false, enabled: false, unavailableReason: null };
    }
    const decision = evaluatePluginUiPolicy(entry, ctx);
    if (!decision.visible || decision.enabled) {
        return {
            visible: decision.visible,
            enabled: decision.enabled,
            unavailableReason: null,
        };
    }
    const availability = entry.availability;
    const pluginId = typeof entry.pluginId === 'string' ? entry.pluginId : null;
    const disabledReason = pluginId && availability && typeof availability === 'object' && !Array.isArray(availability)
        ? readLocalizedText(
            (availability as Readonly<{ disabledReason?: unknown }>).disabledReason,
            pluginId,
            localize,
        )
        : null;
    return {
        visible: true,
        enabled: false,
        unavailableReason: disabledReason ?? decision.diagnostics[0] ?? 'plugin_browser_action_unavailable',
    };
}
