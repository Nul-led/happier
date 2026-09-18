export type CancellablePersonalHomeTaskKind =
    | 'relay.runtime.personal_home.backup.v1'
    | 'relay.runtime.personal_home.restore.v1'
    | 'relay.runtime.personal_home.erase.v1';

export const PERSONAL_HOME_OPERATION_IRREVERSIBLE_BOUNDARY_STEP = Object.freeze({
    'relay.runtime.personal_home.backup.v1': 'stopping_home',
    'relay.runtime.personal_home.restore.v1': 'stopping_home',
    'relay.runtime.personal_home.erase.v1': 'erasing',
    'remote.ssh.manageHost.v1:personalHome.relocate': 'publishing_destination',
});

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
};

const RELOCATION_CANCELLABLE_STEPS: ReadonlySet<string> = new Set([
    'preflight',
    'stopping_source',
    'creating_final_backup',
    'staging_destination',
    'quarantining_source',
    'returning_to_source',
]);

function normalizeStepId(stepId: string | null): string | null {
    if (stepId === null) return null;
    const normalized = stepId.trim();
    if (!normalized.startsWith('personal_home.')) return null;
    return normalized.slice('personal_home.'.length);
}

export function canCancelPersonalHomeOperationProgress(
    kind: string | null,
    stepId: string | null,
    params?: unknown,
): boolean {
    if (kind === 'remote.ssh.manageHost.v1') {
        if (!params || typeof params !== 'object' || Array.isArray(params)
            || (params as Record<string, unknown>).action !== 'personalHome.relocate') return false;
        if (stepId === null) return true;
        if (stepId === 'remote.cli.install') return true;
        const relocationStep = normalizeStepId(stepId);
        return relocationStep !== null && RELOCATION_CANCELLABLE_STEPS.has(relocationStep);
    }
    if (!kind || !(kind in CANCELLABLE_STEPS)) return false;
    if (stepId === null) return true;
    const normalizedStep = normalizeStepId(stepId);
    if (!normalizedStep) return false;
    return CANCELLABLE_STEPS[kind as CancellablePersonalHomeTaskKind].has(normalizedStep);
}
