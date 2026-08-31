export type CancellablePersonalHomeTaskKind =
    | 'relay.runtime.personal_home.backup.v1'
    | 'relay.runtime.personal_home.restore.v1'
    | 'relay.runtime.personal_home.erase.v1'
    | 'relay.runtime.personal_home.relocate.v1';

export const PERSONAL_HOME_OPERATION_IRREVERSIBLE_BOUNDARY_STEP = Object.freeze({
    'relay.runtime.personal_home.backup.v1': 'stopping_home',
    'relay.runtime.personal_home.restore.v1': 'stopping_home',
    'relay.runtime.personal_home.erase.v1': 'erasing',
    'relay.runtime.personal_home.relocate.v1': 'stopping_source',
} satisfies Record<CancellablePersonalHomeTaskKind, string>);

const CANCELLABLE_STEPS: Readonly<Record<CancellablePersonalHomeTaskKind, ReadonlySet<string>>> = {
    'relay.runtime.personal_home.backup.v1': new Set([
        'acquiring_lock',
        'inspecting',
    ]),
    'relay.runtime.personal_home.restore.v1': new Set([
        'acquiring_lock',
        'inspecting_manifest',
        'validating_archive',
        'validating_target',
    ]),
    'relay.runtime.personal_home.erase.v1': new Set([
        'acquiring_lock',
        'awaiting_confirmation',
        'confirm_erase',
    ]),
    'relay.runtime.personal_home.relocate.v1': new Set([
        'acquiring_lock',
        'preflight',
        'staging',
    ]),
};

function normalizeStepId(stepId: string | null): string | null {
    if (stepId === null) return null;
    const normalized = stepId.trim();
    if (!normalized.startsWith('personal_home.')) return null;
    return normalized.slice('personal_home.'.length);
}

export function canCancelPersonalHomeOperationProgress(
    kind: string | null,
    stepId: string | null,
): boolean {
    if (!kind || !(kind in CANCELLABLE_STEPS)) return false;
    if (stepId === null) return true;
    const normalizedStep = normalizeStepId(stepId);
    if (!normalizedStep) return false;
    return CANCELLABLE_STEPS[kind as CancellablePersonalHomeTaskKind].has(normalizedStep);
}
