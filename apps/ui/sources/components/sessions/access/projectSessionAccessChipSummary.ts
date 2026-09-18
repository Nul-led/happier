import { t } from '@/text';
import type { SessionAccessGrantRowModel, SessionAccessSummaryPresentation } from './sessionAccessEditorTypes';

export function projectSessionAccessChipSummary(input: Readonly<{
    grants: readonly SessionAccessGrantRowModel[];
    contextLabel?: string;
    contextTeamId?: string;
    audienceComplete: boolean;
    /**
     * The policy lock for a caller that holds no roster, taken from the viewer's
     * own admitted access sources rather than a recomputed grant census.
     */
    requiredByTeamPolicy?: boolean;
    safeSummary?: SessionAccessSummaryPresentation;
}>): SessionAccessSummaryPresentation {
    if (!input.audienceComplete) {
        if (input.safeSummary) return input.safeSummary;
        // Without an admitted roster the summary may name only the Session's own
        // Team context and its policy lock — never an audience or a total.
        const required = input.requiredByTeamPolicy === true;
        if (!input.contextLabel && !required) {
            return { label: t('session.access.title'), accessibilityLabel: t('session.access.title'), requiredByTeamPolicy: false };
        }
        const context = input.contextLabel ?? t('session.access.title');
        const label = required
            ? t('session.access.withContext', { context, label: t('session.access.required') })
            : context;
        return {
            label,
            accessibilityLabel: t('session.access.accessibleSummary', { title: t('session.access.title'), label }),
            requiredByTeamPolicy: required,
        };
    }
    const requiredByTeamPolicy = input.grants.some((row) => row.requiredByTeamPolicy);
    const mixed = new Set(input.grants.map((row) => row.principal.ref.kind)).size > 1;
    const first = input.grants[0]?.principal.displayName ?? '';
    const audience = input.grants.length === 0 ? t('session.access.private')
        : input.grants.length >= 4 && mixed ? t('session.access.custom')
            : input.grants.length > 1 ? t('session.access.withCount', { label: first, count: input.grants.length - 1 }) : first;
    const firstRef = input.grants[0]?.principal.ref;
    const audienceIsContextTeam = input.grants.length === 1 && firstRef?.kind === 'team' && firstRef.teamId === input.contextTeamId;
    const contextual = input.contextLabel && !audienceIsContextTeam
        ? t('session.access.withContext', { context: input.contextLabel, label: audience }) : audience;
    const label = requiredByTeamPolicy ? t('session.access.withContext', { context: contextual, label: t('session.access.required') }) : contextual;
    const accessibleAudience = input.grants.length ? input.grants.map((row) => row.principal.accessibilityLabel).join('; ') : contextual;
    return { label, accessibilityLabel: t('session.access.accessibleSummary', { title: t('session.access.title'), label: accessibleAudience }), requiredByTeamPolicy };
}
