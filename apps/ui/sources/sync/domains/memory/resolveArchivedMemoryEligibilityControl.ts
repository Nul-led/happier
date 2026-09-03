import type { MemoryStatusV1 } from '@happier-dev/protocol';

export type ArchivedMemoryEligibilityControlV1 = Readonly<{
    /** Whether this daemon advertises implementation support for the setting. */
    supported: boolean;
    /** The eligibility the daemon actually applies; never the desired setting. */
    value: boolean;
}>;

/**
 * Older daemons preserve and echo the additive `includeArchivedSessions`
 * setting while ignoring it, so a desired-settings readback proves nothing.
 * Only the daemon's own `includeArchivedSessionsEffective` advertisement can
 * say the setting is implemented, and its value is what the daemon applies.
 */
export function resolveArchivedMemoryEligibilityControl(params: Readonly<{
    status: MemoryStatusV1 | null | undefined;
    desiredIncludeArchivedSessions: boolean;
}>): ArchivedMemoryEligibilityControlV1 {
    const effective = params.status?.includeArchivedSessionsEffective;
    return typeof effective === 'boolean'
        ? { supported: true, value: effective }
        : { supported: false, value: false };
}
