import { describe, expect, it } from 'vitest';

import {
    resolveWorkspaceSyncErrorTranslationKey,
    resolveWorkspaceSyncModeTranslationKey,
    resolveWorkspaceSyncStateTranslationKey,
} from './workspaceSyncPresentation';

describe('workspaceSyncPresentation', () => {
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
