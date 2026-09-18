import { readSessionOrganizationTagLabel } from '@/sync/domains/session/organization/tagLabels';
import type { SessionOrganizationProjection } from '@/sync/domains/session/organization/types';

import type {
    SessionListFilterHomeOption,
    SessionListFilterTagOption,
} from './sessionListFilterEditorModel';

/**
 * Home-qualified display label for one filter option.
 *
 * Two Homes routinely own different identities that read the same. The label is
 * display metadata only — selection identity stays the qualified address — so the
 * Home name is appended purely to keep two distinct identities distinguishable on
 * screen and to a screen reader. It never becomes part of a key or request field.
 */
export function qualifySessionListFilterOptionLabel(input: Readonly<{
    label: string;
    serverId: string;
    homeOptions: readonly SessionListFilterHomeOption[];
}>): string {
    if (input.homeOptions.length <= 1) return input.label;
    const homeLabel = input.homeOptions.find((home) => home.serverId === input.serverId)?.label;
    return `${input.label} · ${homeLabel ?? input.serverId}`;
}

/**
 * The one qualified tag option list for a Sessions surface, consumed by the full
 * filter editor and by the compact tag shortcut.
 *
 * Tag ids are Home-local and opaque: `urgent` on one Home and `urgent` on another
 * are different tags, and a tag's id is not its label. Both hosts therefore read
 * the same `{serverId, tagId, label}` options from the canonical organization
 * projection instead of deriving a flat label list from loaded rows.
 */
export function buildSessionListFilterTagOptions(input: Readonly<{
    homeOptions: readonly SessionListFilterHomeOption[];
    organizationProjectionsByServerId: Readonly<Record<string, SessionOrganizationProjection>>;
}>): SessionListFilterTagOption[] {
    return input.homeOptions
        .flatMap((home) => Object.values(
            input.organizationProjectionsByServerId[home.serverId]?.tagsById ?? {},
        )
            .filter((tag) => tag.archivedAt == null)
            .flatMap((tag) => {
                const label = readSessionOrganizationTagLabel(tag);
                return label
                    ? [{
                        serverId: home.serverId,
                        tagId: tag.tagId,
                        label: qualifySessionListFilterOptionLabel({
                            label,
                            serverId: home.serverId,
                            homeOptions: input.homeOptions,
                        }),
                    }]
                    : [];
            }))
        .sort((left, right) => left.label.localeCompare(right.label));
}
