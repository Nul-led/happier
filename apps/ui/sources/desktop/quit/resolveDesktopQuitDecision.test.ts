import { describe, expect, it } from 'vitest';

import { resolveDesktopQuitDecision } from './resolveDesktopQuitDecision';

const seen = { activeLocalSessionCount: 0, canSeeDaemonSessions: true } as const;

describe('resolveDesktopQuitDecision (R16 a)', () => {
    it('keeps the tray and the services when they start at login, and touches nothing when the mode is unknown', () => {
        expect(resolveDesktopQuitDecision({ intent: 'quit', serviceAutostart: 'at-login', ...seen })).toBe('keepInMenuBar');
        expect(resolveDesktopQuitDecision({ intent: 'quit', serviceAutostart: null, ...seen })).toBe('leaveRunning');
        // Sessions never turn a keep-running quit into a question.
        expect(resolveDesktopQuitDecision({ intent: 'quit', serviceAutostart: 'at-login', activeLocalSessionCount: 3, canSeeDaemonSessions: true })).toBe('keepInMenuBar');
    });

    it('stops everything on quit when the services only run with the app, and on the explicit stop whatever the mode', () => {
        expect(resolveDesktopQuitDecision({ intent: 'quit', serviceAutostart: 'on-demand', ...seen })).toBe('stop');
        expect(resolveDesktopQuitDecision({ intent: 'stopServices', serviceAutostart: 'at-login', ...seen })).toBe('stop');
        expect(resolveDesktopQuitDecision({ intent: 'stopServices', serviceAutostart: null, ...seen })).toBe('stop');
    });

    it('asks before a stop would end sessions, and asks without claiming any when it cannot see them', () => {
        expect(resolveDesktopQuitDecision({ intent: 'stopServices', serviceAutostart: 'at-login', activeLocalSessionCount: 1, canSeeDaemonSessions: true })).toBe('ask');
        expect(resolveDesktopQuitDecision({ intent: 'quit', serviceAutostart: 'on-demand', activeLocalSessionCount: 0, canSeeDaemonSessions: false })).toBe('askUnknown');
    });
});
