import { describe, expect, it } from 'vitest';

import {
    resolveTemporaryComputerLaunchDismissal,
    type TemporaryComputerLaunchDismissal,
} from './temporaryComputerLaunchDismissal';

describe('Temporary computer launch dismissal', () => {
    it('never revokes a live package when the surface is merely dismissed', () => {
        const live = ['pending', 'claimed', 'consented'] as const;
        for (const projectionState of live) {
            expect(resolveTemporaryComputerLaunchDismissal({
                status: 'waiting_for_computer',
                projectionState,
            })).toBe('leave_composer' satisfies TemporaryComputerLaunchDismissal);
        }
    });

    it('leaves the composer while preparation is still in flight rather than canceling it', () => {
        expect(resolveTemporaryComputerLaunchDismissal({
            status: 'preparing',
            projectionState: null,
        })).toBe('leave_composer');
        expect(resolveTemporaryComputerLaunchDismissal({
            status: 'reconciling',
            projectionState: null,
        })).toBe('leave_composer');
    });

    it('acknowledges an already-closed activation instead of navigating away', () => {
        expect(resolveTemporaryComputerLaunchDismissal({
            status: 'failed',
            projectionState: 'closed',
        })).toBe('acknowledge_terminal');
    });

    // Nothing reached the Home, so Escape or Back is the same "return to the
    // composer" the surface action performs — not a route change that would
    // leave the request behind in the Drafts group.
    it('returns a deterministic authoring incompatibility to the composer', () => {
        for (const status of ['profile_changed', 'profile_environment_unavailable'] as const) {
            expect(resolveTemporaryComputerLaunchDismissal({
                status,
                projectionState: null,
            })).toBe('acknowledge_terminal' satisfies TemporaryComputerLaunchDismissal);
        }
    });

    it('does nothing when no launch attempt owns the screen', () => {
        expect(resolveTemporaryComputerLaunchDismissal({
            status: 'idle',
            projectionState: null,
        })).toBe('none');
    });

    it('keeps a materialized activation alive so the ordinary Session handoff completes', () => {
        expect(resolveTemporaryComputerLaunchDismissal({
            status: 'succeeded',
            projectionState: 'materialized',
        })).toBe('leave_composer');
    });
});
