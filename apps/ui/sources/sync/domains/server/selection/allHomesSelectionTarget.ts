/**
 * "All Homes": the selection that shows every Home this device has saved, together, grouped by
 * Home. It is a virtual group target — never stored in `serverSelectionGroups` — so it always
 * follows the saved Homes as they are added and removed, and it exists only while there are two
 * or more. The id is outside the character set of person-made group ids (lowercase letters,
 * digits, `.`, `_`, `-`), so it can never collide with a group someone creates.
 */
export const ALL_HOMES_SELECTION_TARGET_ID = '@all-homes';

/** The fewest saved Homes for which "All Homes" means anything. */
export const ALL_HOMES_MINIMUM_HOME_COUNT = 2;

export function isAllHomesSelectionTargetId(id: unknown): boolean {
    return typeof id === 'string' && id.trim() === ALL_HOMES_SELECTION_TARGET_ID;
}
