import { describe, expect, it } from 'vitest';

import {
    formatWorkspaceSyncRelationshipTitle,
    resolveWorkspaceSyncConflictOpenTarget,
    resolveWorkspaceSyncErrorTranslationKey,
    resolveWorkspaceSyncModeTranslationKey,
    resolveWorkspaceSyncStateTranslationKey,
} from './workspaceSyncPresentation';

describe('workspaceSyncPresentation', () => {
    it('uses directional relationship titles for immutable one-way and two-way modes', () => {
        expect(formatWorkspaceSyncRelationshipTitle({
            alphaLabel: 'Source',
            betaLabel: 'Destination',
            mode: 'keep_synced',
        })).toBe('Source → Destination');
        expect(formatWorkspaceSyncRelationshipTitle({
            alphaLabel: 'Alpha',
            betaLabel: 'Beta',
            mode: 'keep_both_in_sync',
        })).toBe('Alpha ↔ Beta');
    });

    it('opens the exact relationship only when one relationship owns the conflict attention', () => {
        expect(resolveWorkspaceSyncConflictOpenTarget([
            { relationshipId: 'one', conflictCount: 2 },
            { relationshipId: 'healthy', conflictCount: 0 },
        ])).toEqual({ kind: 'relationship', relationshipId: 'one' });
        expect(resolveWorkspaceSyncConflictOpenTarget([
            { relationshipId: 'one', conflictCount: 1 },
            { relationshipId: 'two', conflictCount: 3 },
        ])).toEqual({ kind: 'relationshipList' });
        expect(resolveWorkspaceSyncConflictOpenTarget([
            { relationshipId: 'healthy', conflictCount: 0 },
        ])).toEqual({ kind: 'none' });
    });

    it('keeps every released mode distinct and fails closed for unknown modes', () => {
        expect([
            'copy_once',
            'keep_synced',
            'mirror_exactly',
            'keep_both_in_sync',
        ].map(resolveWorkspaceSyncModeTranslationKey)).toEqual([
            'workspaceSync.mode.copyOnce',
            'workspaceSync.mode.keepSynced',
            'workspaceSync.mode.mirrorExactly',
            'workspaceSync.mode.keepBothInSync',
        ]);
        expect(resolveWorkspaceSyncModeTranslationKey('future-mode')).toBeNull();
    });

    it('does not reinterpret unavailable or unknown daemon state as healthy', () => {
        expect(resolveWorkspaceSyncStateTranslationKey('controller_unavailable')).toBe('workspaceSync.state.controllerUnavailable');
        expect(resolveWorkspaceSyncStateTranslationKey('disconnected')).toBe('workspaceSync.state.peerOffline');
        expect(resolveWorkspaceSyncStateTranslationKey('future-state')).toBeNull();
    });

    it('maps actionable daemon failures without exposing implementation vocabulary', () => {
        expect(resolveWorkspaceSyncErrorTranslationKey('engine_unavailable')).toBe('workspaceSync.error.componentUnavailable');
        expect(resolveWorkspaceSyncErrorTranslationKey('machine_carrier_unavailable')).toBe('workspaceSync.error.machineOffline');
        expect(resolveWorkspaceSyncErrorTranslationKey('target_bootstrap_required')).toBe('workspaceSync.error.destinationNeedsPreparation');
        expect(resolveWorkspaceSyncErrorTranslationKey('git_selection_unavailable')).toBe('workspaceSync.error.gitPreparationFailed');
        expect(resolveWorkspaceSyncErrorTranslationKey('root_changed')).toBe('workspaceSync.error.rootNoLongerAuthorized');
        expect(resolveWorkspaceSyncErrorTranslationKey('future-error')).toBe('workspaceSync.error.needsAttention');
        expect(resolveWorkspaceSyncErrorTranslationKey(null)).toBeNull();
    });
});
