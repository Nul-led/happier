import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { hasTranslation, setPreferredLanguageFromSettings, tLoose } from '@/text';

import { PersonalHomeSetupSurface } from './PersonalHomeSetupSurface';
import type { PersonalHomeBootstrapSnapshot } from '../bootstrap/personalHomeBootstrapTypes';

const snapshot: PersonalHomeBootstrapSnapshot = {
    shouldGateShell: true,
    homeReady: false,
    daemonReady: false,
    phase: 'preparing-home',
    daemonState: 'not-started',
    rows: [
        { id: 'home', status: 'active' },
        { id: 'app', status: 'pending' },
        { id: 'computer', status: 'pending' },
    ],
    action: 'none',
};

describe('PersonalHomeSetupSurface', () => {
    it('resolves every setup label through the canonical translation catalog', () => {
        const keys = [
            'title',
            'preparingHomeStatus',
            'connectingAppStatus',
            'closingSignupStatus',
            'preparingComputerStatus',
            'blockedStatus',
            'readyStatus',
            'preparingHomeTitle',
            'preparingHomeDetail',
            'connectingAppTitle',
            'connectingAppDetail',
            'preparingComputerTitle',
            'preparingComputerDetail',
            'pending',
            'active',
            'complete',
            'blocked',
            'progressLabel',
            'rowAccessibilityLabel',
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

    it('renders one stable operational frame with three semantic rows', async () => {
        const screen = await renderScreen(<PersonalHomeSetupSurface snapshot={snapshot} />);
        expect(screen.findByTestId('personal-home-setup-surface')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-row-home')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-row-app')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-row-computer')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-phase')).not.toBeNull();
    });

    it('preserves completed rows and exposes retry/details for failure', async () => {
        const failed: PersonalHomeBootstrapSnapshot = {
            ...snapshot,
            phase: 'blocked',
            action: 'retry',
            rows: [
                { id: 'home', status: 'complete' },
                { id: 'app', status: 'blocked' },
                { id: 'computer', status: 'pending' },
            ],
            detail: { code: 'auth', message: 'Needs attention', retryable: true },
        };
        const screen = await renderScreen(
            <PersonalHomeSetupSurface snapshot={failed} onRetry={() => {}} onOpenDetails={() => {}} />,
        );
        expect(screen.findByTestId('personal-home-bootstrap-retry')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-details')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-row-home')).not.toBeNull();
    });

    it('exposes exactly one working details action for a failed active task', async () => {
        const failed: PersonalHomeBootstrapSnapshot = {
            ...snapshot,
            phase: 'blocked',
            action: 'retry',
            rows: [
                { id: 'home', status: 'complete' },
                { id: 'app', status: 'blocked' },
                { id: 'computer', status: 'pending' },
            ],
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
            rows: [
                { id: 'home', status: 'complete' },
                { id: 'app', status: 'blocked' },
                { id: 'computer', status: 'pending' },
            ],
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
