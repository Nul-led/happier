/** The exact resource revision an open settings editor was populated from. */
export type RevisionedSettingsDraftOrigin = Readonly<{
    resourceId: string;
    revision: number;
}>;

export type RevisionedSettingsDraftTransition =
    /** Replace the editor with the current resource values. */
    | 'adopt'
    /** Nothing advanced; leave the editor alone. */
    | 'keep'
    /** The resource advanced under an unsaved edit; keep it and explain it. */
    | 'conflict';

/**
 * Reconciles an editor's local draft with a refreshed revisioned projection.
 *
 * Unsaved work is never discarded by a background refresh. A quiet editor
 * adopts a newer revision, while a dirty editor preserves its values and
 * requires an explicit reload/review before retrying the CAS mutation. Older
 * projections are retained snapshots and must never roll an editor backward.
 */
export function revisionedSettingsDraftTransition(input: Readonly<{
    origin: RevisionedSettingsDraftOrigin | null;
    current: RevisionedSettingsDraftOrigin;
    dirty: boolean;
}>): RevisionedSettingsDraftTransition {
    const { origin, current } = input;
    if (!origin || origin.resourceId !== current.resourceId) return 'adopt';
    if (current.revision <= origin.revision) return 'keep';
    return input.dirty ? 'conflict' : 'adopt';
}
