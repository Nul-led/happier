export type PresentationNoticeSeverity = 'info' | 'warning' | 'error';

/**
 * A caller-owned safe local inverse offered beside the notice.
 *
 * The host renders the control and nothing else: it performs no Board, domain or
 * wire mutation, and it never accepts an executable wire/plugin callback. The
 * publisher binds `run` to its own exact Account/Home/Session and mounted
 * controller, compares only the presentation fields it applied, and restores
 * only those fields while they are unchanged — so a newer manual change is never
 * overwritten. A replaced notice simply stops offering its inverse; there is no
 * undo stack, history or separate lifetime.
 */
export type PresentationNoticeUndo = Readonly<{
    /** Already-localized action label, e.g. "Undo". */
    label: string;
    run: () => void;
}>;

export type PresentationNotice = Readonly<{
    key: string;
    message: string;
    severity: PresentationNoticeSeverity;
    undo?: PresentationNoticeUndo;
}>;

/**
 * The app's transient presentation notice — one owner, two producers.
 *
 * `CurrentSessionPresentationRuntime` renders it and is mounted app-globally by
 * `AuthenticatedAppRuntimeMounts`. Until now the notice lived in that
 * component's local state, reachable only from the daemon's
 * `CurrentSessionPresentation` command stream. Mounted plugin UI needs the same
 * outcome for its `notify` host method (§3.4), and UI-T21 forbids a
 * plugin-only notification store — so the state moved out of the component into
 * this module and both producers publish here.
 *
 * It follows the presentation domain's existing module-store idiom
 * (`sessionComposerPresentationTargets.ts`): a single current value plus
 * listeners, no queue and no scheduler. A newer notice replaces an older one,
 * which is what a single transient notice host can show.
 */
let current: PresentationNotice | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

export function publishPresentationNotice(notice: PresentationNotice): void {
    current = notice;
    emit();
}

/**
 * Retire a notice. Passing the key makes retirement exact: a timer that fires
 * after a newer notice arrived does not clear the newer one.
 */
export function retirePresentationNotice(key?: string): void {
    if (current === null) return;
    if (key !== undefined && current.key !== key) return;
    current = null;
    emit();
}

export function readPresentationNotice(): PresentationNotice | null {
    return current;
}

export function subscribePresentationNotices(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
