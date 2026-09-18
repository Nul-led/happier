import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ View: 'View' });
});

describe('NewSessionLaunchSurface', () => {
    it('keeps the mounted authoring tree inert and outside accessibility traversal while launch custody is active', async () => {
        const { NewSessionLaunchSurface } = await import('./NewSessionLaunchSurface');
        const screen = await renderScreen(
            <NewSessionLaunchSurface overlay={<ViewFixture testID="launch-overlay" />} onRequestClose={() => undefined}>
                <ViewFixture testID="authoring-tree" />
            </NewSessionLaunchSurface>,
        );

        const authoring = screen.findByTestId('new-session-launch-authoring');
        expect(authoring?.props.pointerEvents).toBe('none');
        expect(authoring?.props['aria-hidden']).toBe(true);
        expect(authoring?.props.inert).toBe(true);
        expect(screen.findByTestId('launch-overlay')).not.toBeNull();
    });

    it('leaves ordinary authoring interactive when no launch overlay owns the screen', async () => {
        const { NewSessionLaunchSurface } = await import('./NewSessionLaunchSurface');
        const screen = await renderScreen(
            <NewSessionLaunchSurface overlay={null} onRequestClose={() => undefined}>
                <ViewFixture testID="authoring-tree" />
            </NewSessionLaunchSurface>,
        );

        const authoring = screen.findByTestId('new-session-launch-authoring');
        expect(authoring?.props.pointerEvents).toBe('auto');
        expect(authoring?.props['aria-hidden']).not.toBe(true);
        expect(authoring?.props.inert).not.toBe(true);
        expect(screen.findByTestId('new-session-launch-overlay')).toBeNull();
    });

    it('uses the incumbent full-screen host and supplied accessibility identity for compact editors', async () => {
        const { NewSessionLaunchSurface } = await import('./NewSessionLaunchSurface');
        const screen = await renderScreen(
            <NewSessionLaunchSurface
                overlay={<ViewFixture testID="access-editor" />}
                onRequestClose={() => undefined}
                overlayPresentation="screen"
                overlayAccessibilityLabel="Session access"
            >
                <ViewFixture testID="authoring-tree" />
            </NewSessionLaunchSurface>,
        );

        expect(screen.findByTestId('new-session-full-screen-overlay')).not.toBeNull();
        expect(screen.findByTestId('new-session-launch-overlay-scroll')).toBeNull();
        expect(screen.findByTestId('new-session-launch-overlay')?.props.accessibilityLabel).toBe('Session access');
    });
});

function ViewFixture(props: Readonly<{ testID: string }>): React.ReactElement {
    return React.createElement('View', props);
}
