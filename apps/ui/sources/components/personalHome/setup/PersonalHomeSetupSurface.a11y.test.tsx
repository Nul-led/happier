import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { PersonalHomeSetupSurface } from './PersonalHomeSetupSurface';

describe('PersonalHomeSetupSurface accessibility', () => {
    it('uses one polite phase announcement and one non-repeating failure alert', async () => {
        const screen = await renderScreen(
            <PersonalHomeSetupSurface
                snapshot={{
                    shouldGateShell: true,
                    homeReady: false,
                    daemonReady: false,
                    phase: 'blocked',
                    daemonState: 'not-started',
                    action: 'retry',
                    detail: { message: 'Needs attention', retryable: true },
                }}
                onRetry={() => {}}
                onOpenDetails={() => {}}
            />,
        );
        const phase = screen.findByTestId('personal-home-bootstrap-phase');
        expect(phase?.props.accessibilityLiveRegion).toBe('polite');
        expect(screen.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLiveRegion === 'polite')).toHaveLength(1);
        expect(screen.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLiveRegion === 'assertive')).toHaveLength(1);
        expect(screen.findByTestId('personal-home-bootstrap-retry')?.props.accessibilityRole).toBe('button');
        expect(screen.findByTestId('personal-home-bootstrap-details')?.props.accessibilityRole).toBe('button');
        expect(screen.findByTestId('personal-home-bootstrap-failure')?.props.accessibilityRole).toBe('alert');
    });

    it('keeps the single activity treatment decorative while the concise status owns announcements', async () => {
        const screen = await renderScreen(
            <PersonalHomeSetupSurface
                snapshot={{
                    shouldGateShell: true,
                    homeReady: false,
                    daemonReady: false,
                    phase: 'ensuring-home',
                    daemonState: 'not-started',
                    action: 'none',
                }}
            />,
        );

        const activity = screen.findByTestId('personal-home-bootstrap-activity');
        expect(activity?.props.accessible).toBe(false);
        expect(activity?.props.accessibilityLiveRegion).toBeUndefined();
        expect(screen.findByTestId('personal-home-bootstrap-phase')?.props.accessibilityLiveRegion).toBe('polite');
    });

    it('focuses the first recovery action once when setup becomes blocked', async () => {
        const retryFocus = vi.fn();
        const preparing = {
            shouldGateShell: true,
            homeReady: false,
            daemonReady: false,
            phase: 'ensuring-home' as const,
            daemonState: 'not-started' as const,
            action: 'none' as const,
        };
        const blocked = {
            ...preparing,
            phase: 'blocked' as const,
            action: 'retry' as const,
            detail: { message: 'Technical detail shown only in diagnostics', retryable: true },
        };
        const render = (snapshot: typeof preparing | typeof blocked) => (
            <PersonalHomeSetupSurface snapshot={snapshot} onRetry={() => {}} />
        );
        const screen = await renderScreen(render(preparing), {
            createNodeMock: (element) => (
                (element.props as Readonly<{ testID?: string }>).testID === 'personal-home-bootstrap-retry'
                    ? { focus: retryFocus }
                    : null
            ),
        });

        await act(async () => {
            screen.tree.update(render(blocked));
        });
        expect(retryFocus).toHaveBeenCalledTimes(1);

        await act(async () => {
            screen.tree.update(render(blocked));
        });
        expect(retryFocus).toHaveBeenCalledTimes(1);
    });
});
