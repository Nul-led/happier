import {
    areServerAccountScopesEqual,
    type ServerAccountScope,
} from '@/sync/domains/scope/serverAccountScope';

export type NewSessionDraftPersistenceBinding = Readonly<{
    follow(scope: ServerAccountScope | null): void;
    pause(scope: ServerAccountScope): void;
    resume(scope: ServerAccountScope): boolean;
    disable(): void;
    readScopeForWrite(): ServerAccountScope | null;
}>;

/**
 * The launch boundary must commit the live editable draft before freezing its
 * scoped writer. Keeping the order in the binding owner prevents callers from
 * pausing first and accidentally turning the final write into a no-op.
 */
export function persistNewSessionDraftAndPause(input: Readonly<{
    binding: NewSessionDraftPersistenceBinding;
    scope: ServerAccountScope;
    persist: (scope: ServerAccountScope) => void;
}>): void {
    input.persist(input.scope);
    input.binding.pause(input.scope);
}

/**
 * The one mutable binding behind ordinary New Session autosave. Temporary
 * launch pauses this owner and may pin it to a destination Home; it never
 * creates another draft writer or lets a focused-Home change retarget writes.
 */
export function createNewSessionDraftPersistenceBinding(
    initialScope: ServerAccountScope | null,
): NewSessionDraftPersistenceBinding {
    let mode: 'following' | 'pinned' = 'following';
    let state: 'enabled' | 'paused' | 'disabled' = 'enabled';
    let scope = initialScope;

    return Object.freeze({
        follow(nextScope) {
            if (mode === 'following' && !areServerAccountScopesEqual(scope, nextScope)) {
                scope = nextScope;
            }
        },
        pause(nextScope) {
            mode = 'pinned';
            scope = nextScope;
            state = 'paused';
        },
        resume(nextScope) {
            if (state !== 'paused' || !areServerAccountScopesEqual(scope, nextScope)) return false;
            mode = 'pinned';
            state = 'enabled';
            return true;
        },
        disable() {
            state = 'disabled';
        },
        readScopeForWrite() {
            return state === 'enabled' ? scope : null;
        },
    });
}
