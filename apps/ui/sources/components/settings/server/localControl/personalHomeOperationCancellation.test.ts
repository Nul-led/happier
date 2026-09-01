import { describe, expect, it } from 'vitest';

import {
    canCancelPersonalHomeOperationProgress,
    PERSONAL_HOME_OPERATION_IRREVERSIBLE_BOUNDARY_STEP,
} from './personalHomeOperationCancellation';

describe('canCancelPersonalHomeOperationProgress', () => {
    it('keeps cancellation available before each irreversible boundary and hides it from the boundary onward', () => {
        const cases: ReadonlyArray<Readonly<{
            kind: Parameters<typeof canCancelPersonalHomeOperationProgress>[0];
            stepId: string | null;
            expected: boolean;
            because: string;
        }>> = [
            // Backup: the Home stop plus offline SQLite checkpoint is the last cancellable moment;
            // after it the archive staging/hashing cannot honor cancellation.
            { kind: 'relay.runtime.personal_home.backup.v1', stepId: null, expected: true, because: 'no progress yet is pre-boundary' },
            { kind: 'relay.runtime.personal_home.backup.v1', stepId: 'personal_home.inspecting', expected: true, because: 'inspecting precedes the boundary' },
            { kind: 'relay.runtime.personal_home.backup.v1', stepId: 'personal_home.stopping_home', expected: false, because: 'stopping_home is the backup irreversible boundary' },
            { kind: 'relay.runtime.personal_home.backup.v1', stepId: 'personal_home.checkpointing', expected: false, because: 'checkpointing is past the backup boundary' },
            { kind: 'relay.runtime.personal_home.backup.v1', stepId: 'personal_home.validating_database', expected: false, because: 'validation runs after the source was already stopped' },
            { kind: 'relay.runtime.personal_home.backup.v1', stepId: 'personal_home.restarting_home', expected: false, because: 'restart follows the archive mutation' },
            // Restore: once the destination Home is stopping, the preserve/promote swap cannot be cancelled.
            { kind: 'relay.runtime.personal_home.restore.v1', stepId: 'personal_home.validating_archive', expected: true, because: 'archive validation still honors cancellation' },
            { kind: 'relay.runtime.personal_home.restore.v1', stepId: 'personal_home.stopping_home', expected: false, because: 'stopping_home is the restore irreversible boundary' },
            { kind: 'relay.runtime.personal_home.restore.v1', stepId: 'personal_home.starting_home', expected: false, because: 'promotion/activation already happened' },
            { kind: 'relay.runtime.personal_home.restore.v1', stepId: 'personal_home.health_check', expected: false, because: 'health check runs on the promoted Home' },
            // Erase: deletion only becomes unconsoleable at the erasing step; confirmation may still be cancelled.
            { kind: 'relay.runtime.personal_home.erase.v1', stepId: 'personal_home.acquiring_lock', expected: true, because: 'lock acquisition is pre-boundary' },
            { kind: 'relay.runtime.personal_home.erase.v1', stepId: 'personal_home.awaiting_confirmation', expected: true, because: 'explicit confirmation is still cancellable' },
            { kind: 'relay.runtime.personal_home.erase.v1', stepId: 'personal_home.erasing', expected: false, because: 'erasing is the erase irreversible boundary' },
        ];

        for (const testCase of cases) {
            expect(canCancelPersonalHomeOperationProgress(testCase.kind, testCase.stepId)).toBe(testCase.expected);
        }
    });

    it('fails closed for unrecognized progress instead of pretending cancellation is honored', () => {
        expect(canCancelPersonalHomeOperationProgress('relay.runtime.personal_home.backup.v1', 'personal_home.unknown_future_step')).toBe(false);
        expect(canCancelPersonalHomeOperationProgress('relay.runtime.personal_home.backup.v1', '')).toBe(false);
    });

    it('never offers cancellation for operation kinds without a typed boundary contract', () => {
        expect(canCancelPersonalHomeOperationProgress('relay.runtime.personal_home.inspect.v1', 'personal_home.inspecting')).toBe(false);
    });

    it('declares one named irreversible boundary per moving-data operation', () => {
        expect(PERSONAL_HOME_OPERATION_IRREVERSIBLE_BOUNDARY_STEP).toEqual({
            'relay.runtime.personal_home.backup.v1': 'stopping_home',
            'relay.runtime.personal_home.restore.v1': 'stopping_home',
            'relay.runtime.personal_home.erase.v1': 'erasing',
        });
    });
});
