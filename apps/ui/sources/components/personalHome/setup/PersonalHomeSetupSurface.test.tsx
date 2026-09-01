import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { hasTranslation, setPreferredLanguageFromSettings, tLoose } from '@/text';

import { PersonalHomeSetupSurface } from './PersonalHomeSetupSurface';
import { sanitizePersonalHomeDiagnosticMessage } from './PersonalHomeDiagnosticDetails';
import type { PersonalHomeBootstrapSnapshot } from '../bootstrap/personalHomeBootstrapTypes';

const snapshot: PersonalHomeBootstrapSnapshot = {
    shouldGateShell: true,
    homeReady: false,
    daemonReady: false,
    phase: 'ensuring-home',
    daemonState: 'not-started',
    action: 'none',
};

describe('PersonalHomeSetupSurface', () => {
    it('redacts explicit secrets without hiding ordinary custody and credential failure prose', () => {
        expect(sanitizePersonalHomeDiagnosticMessage('seed custody is unavailable')).toBe('seed custody is unavailable');
        expect(sanitizePersonalHomeDiagnosticMessage('credential persistence failed')).toBe('credential persistence failed');
        expect(sanitizePersonalHomeDiagnosticMessage('seed=abcdef0123456789abcdef0123456789')).toBe('seed=[redacted]');
        expect(sanitizePersonalHomeDiagnosticMessage('authorization=opaque-value')).toBe('authorization=[redacted]');
        expect(sanitizePersonalHomeDiagnosticMessage('Authorization: Bearer top-secret-token')).toBe('Authorization: Bearer [redacted]');
    });

    it('resolves every setup label through the canonical translation catalog', () => {
        const keys = [
            'title',
            'ensuringHomeStatus',
            'preparingComputerStatus',
            'blockedStatus',
            'readyStatus',
            'failureBody',
            'profileRecoveryBody',
            'computerRecoveryBody',
            'existingRuntimeBody',
            'useExisting',
            'useExistingDetail',
            'useAnother',
            'useAnotherDetail',
        ];

        for (const key of keys) {
            expect(hasTranslation(`personalHome.bootstrap.${key}`)).toBe(true);
        }

        setPreferredLanguageFromSettings('de');
        try {
            expect(tLoose('personalHome.bootstrap.title')).not.toBe('personalHome.bootstrap.title');
        } finally {
            setPreferredLanguageFromSettings(null);
        }
    });

    it('renders one stable operational frame with one live status and one activity treatment', async () => {
        const screen = await renderScreen(<PersonalHomeSetupSurface snapshot={snapshot} />);
        expect(screen.findByTestId('personal-home-setup-surface')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-phase')).not.toBeNull();
        expect(screen.findAllHostsByTestId('personal-home-bootstrap-activity')).toHaveLength(1);
        expect(screen.findByTestId('personal-home-bootstrap-progress')).toBeNull();
    });

    it('exposes retry/details for failure without a competing progress checklist', async () => {
        const failed: PersonalHomeBootstrapSnapshot = {
            ...snapshot,
            phase: 'blocked',
            action: 'retry',
            detail: { code: 'auth', message: 'Needs attention', retryable: true },
        };
        const screen = await renderScreen(
            <PersonalHomeSetupSurface snapshot={failed} onRetry={() => {}} onOpenDetails={() => {}} />,
        );
        expect(screen.findByTestId('personal-home-bootstrap-retry')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-details')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-activity')).toBeNull();
    });

    it('discloses sanitized failure details without an active task or external callback', async () => {
        const failed: PersonalHomeBootstrapSnapshot = {
            ...snapshot,
            phase: 'blocked',
            action: 'retry',
            detail: {
                code: 'credential_write_failed',
                message: 'Authorization: Bearer top-secret-token; seed=abcdef0123456789abcdef0123456789',
                retryable: true,
            },
        };
        const screen = await renderScreen(<PersonalHomeSetupSurface snapshot={failed} onRetry={() => {}} />);

        expect(screen.findByTestId('personal-home-bootstrap-details')).not.toBeNull();
        await screen.pressByTestIdAsync('personal-home-bootstrap-details');
        expect(screen.findByTestId('personal-home-bootstrap-details-panel')).not.toBeNull();
        expect(screen.findAllHostsByTestId('personal-home-diagnostic-code')).toHaveLength(1);
        expect(screen.root.findAll((node) => typeof node.props.children === 'string' && node.props.children.includes('top-secret-token'))).toHaveLength(0);
        expect(screen.root.findAll((node) => typeof node.props.children === 'string' && node.props.children.includes('abcdef0123456789abcdef0123456789'))).toHaveLength(0);
    });

    it('exposes exactly one working details action for a failed active task', async () => {
        const failed: PersonalHomeBootstrapSnapshot = {
            ...snapshot,
            phase: 'blocked',
            action: 'retry',
            detail: { code: 'auth', message: 'Technical detail shown only in diagnostics', retryable: true },
        };
        const screen = await renderScreen(
            <PersonalHomeSetupSurface
                snapshot={failed}
                activeTask={{
                    status: 'running',
                    taskId: 'personal-home-test',
                    currentStepId: null,
                    latestMessage: null,
                    awaitingInput: false,
                    cancelRequested: false,
                    events: [],
                    result: null,
                }}
                onRetry={() => {}}
            />,
        );

        expect(screen.findAllHostsByTestId('personal-home-bootstrap-details')).toHaveLength(1);
        expect(screen.findAllHostsByTestId('personal-home-bootstrap-details-toggle')).toHaveLength(0);
        await screen.pressByTestIdAsync('personal-home-bootstrap-details');
        expect(screen.findByTestId('personal-home-bootstrap-details-panel')).not.toBeNull();
    });

    it('shows the existing-Home choice without a competing generic failure surface', async () => {
        const needsChoice: PersonalHomeBootstrapSnapshot = {
            ...snapshot,
            phase: 'blocked',
            action: 'choose-existing-runtime',
            detail: { code: 'existing_runtime', message: 'Existing runtime', retryable: false },
        };
        const screen = await renderScreen(
            <PersonalHomeSetupSurface
                snapshot={needsChoice}
                onUseExisting={() => {}}
                onUseAnotherHome={() => {}}
            />,
        );

        expect(screen.findByTestId('personal-home-existing-runtime-decision')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-failure')).toBeNull();
    });
});
