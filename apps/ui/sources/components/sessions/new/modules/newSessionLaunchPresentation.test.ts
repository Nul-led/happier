import { describe, expect, it } from 'vitest';

import { createNewSessionLaunchAttempt, markNewSessionLaunchAttemptCreated, markNewSessionLaunchAttemptSpawning } from './newSessionLaunchAttempt';
import { resolveNewSessionLaunchPresentation } from './newSessionLaunchPresentation';

function attempt(prompt = 'Fix the failing import') {
    return createNewSessionLaunchAttempt({ prompt, displayText: prompt, scopeKey: 'scope-a', configurationUpdatedAtMs: 0 });
}

describe('resolveNewSessionLaunchPresentation', () => {
    it('renders nothing before the author sends', () => {
        expect(resolveNewSessionLaunchPresentation({
            temporaryComputerLaunchActive: false,
            isCreating: false,
            pendingLaunchAttempt: attempt(),
        })).toBe('none');
    });

    it('renders the compact pending card for an ordinary exact-Machine launch', () => {
        expect(resolveNewSessionLaunchPresentation({
            temporaryComputerLaunchActive: false,
            isCreating: true,
            pendingLaunchAttempt: markNewSessionLaunchAttemptSpawning(attempt()),
        })).toBe('machine');
    });

    it('stops the compact pending card once the Session exists', () => {
        expect(resolveNewSessionLaunchPresentation({
            temporaryComputerLaunchActive: false,
            isCreating: true,
            pendingLaunchAttempt: markNewSessionLaunchAttemptCreated(attempt(), { createdSessionId: 'session-1' }),
        })).toBe('none');
    });

    it('has nothing to preview for an empty prompt', () => {
        expect(resolveNewSessionLaunchPresentation({
            temporaryComputerLaunchActive: false,
            isCreating: true,
            pendingLaunchAttempt: attempt('   '),
        })).toBe('none');
    });

    // The defect this owner exists to remove: the Temporary-computer path publishes
    // an ordinary pending launch attempt *and* sets `isCreating` while its blocking
    // waiting surface owns the screen. With two independent decisions in the Simple
    // panel and the Wizard, one launch grew two competing pending presentations —
    // one of them behind an inert, accessibility-hidden authoring tree.
    it('never shows a second pending card while a temporary launch owns the screen', () => {
        expect(resolveNewSessionLaunchPresentation({
            temporaryComputerLaunchActive: true,
            isCreating: true,
            pendingLaunchAttempt: attempt(),
        })).toBe('temporary_computer');
    });

    it('keeps the waiting surface presented after navigation back into a reconciling draft', () => {
        expect(resolveNewSessionLaunchPresentation({
            temporaryComputerLaunchActive: true,
            isCreating: false,
            pendingLaunchAttempt: null,
        })).toBe('temporary_computer');
    });
});
