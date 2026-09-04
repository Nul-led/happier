import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

describe('WebDesktopHandoffStep', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('creates a Personal Home instead of installing a generic relay runtime', async () => {
        const { WebDesktopHandoffStep } = await import('./WebDesktopHandoffStep');
        const screen = await renderScreen(React.createElement(WebDesktopHandoffStep, {
            testID: 'web-desktop-handoff',
        }));

        expect(screen.findByTestId('web-desktop-handoff')).toBeTruthy();
        expect(screen.findByTestId('web-desktop-handoff-download-desktop')).toBeTruthy();

        expect(screen.findByTestId('web-desktop-handoff-terminal')).toBeTruthy();
        expect(screen.findByTestId('web-desktop-handoff-divider')).toBeTruthy();

        expect(screen.findByTestId('web-desktop-handoff-terminal-step-relay-setup')).toBeTruthy();
        const commands = screen.getTextContent();
        expect(commands).toContain('happier home create');
        expect(commands).not.toContain('setup-relay');
        expect(commands).not.toContain('relay host install');
    });

    it('includes a single setup command for the background-service handoff', async () => {
        const { WebDesktopBackgroundServiceHandoffStep } = await import('./WebDesktopBackgroundServiceHandoffStep');
        const screen = await renderScreen(React.createElement(WebDesktopBackgroundServiceHandoffStep, {
            testID: 'web-background-service-handoff',
            relayUrl: 'https://relay.example.test',
        }));

        expect(screen.findByTestId('web-background-service-handoff')).toBeTruthy();
        expect(screen.findByTestId('web-background-service-handoff-download-desktop')).toBeTruthy();
        expect(screen.findByTestId('web-background-service-handoff-divider')).toBeTruthy();
        expect(screen.findByTestId('web-background-service-handoff-terminal-step-setup')).toBeTruthy();
        expect(screen.findByTestId('web-background-service-handoff-terminal-step-daemon-install')).toBeNull();
        expect(screen.findByTestId('web-background-service-handoff-terminal-step-daemon-start')).toBeNull();
        const commands = screen.getTextContent();
        expect(commands).toContain('setup --home-url https://relay.example.test --skip-providers');
        expect(commands).not.toContain('setup --relay-url');
        expect(commands).not.toContain('--yes');
    });

});
