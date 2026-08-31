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
                    rows: [
                        { id: 'home', status: 'complete' },
                        { id: 'app', status: 'blocked' },
                        { id: 'computer', status: 'pending' },
                    ],
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

    it('exposes each progress row as one named state without announcing every row update', async () => {
        const screen = await renderScreen(
            <PersonalHomeSetupSurface
                snapshot={{
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
                }}
            />,
        );

        const activeRow = screen.findByTestId('personal-home-bootstrap-row-home');
        const pendingRow = screen.findByTestId('personal-home-bootstrap-row-app');
        expect(activeRow?.props.accessible).toBe(true);
        expect(activeRow?.props.accessibilityState).toEqual({ busy: true });
        expect(activeRow?.props.accessibilityLabel).toEqual(expect.any(String));
        expect(pendingRow?.props.accessibilityState).toEqual({ busy: false });
        expect(pendingRow?.props.accessibilityLabel).not.toBe(activeRow?.props.accessibilityLabel);
        expect(activeRow?.props.accessibilityLiveRegion).toBeUndefined();
    });

    it('focuses the first recovery action once when setup becomes blocked', async () => {
        const retryFocus = vi.fn();
        const preparing = {
            shouldGateShell: true,
            homeReady: false,
            daemonReady: false,
            phase: 'preparing-home' as const,
            daemonState: 'not-started' as const,
            rows: [
                { id: 'home' as const, status: 'active' as const },
                { id: 'app' as const, status: 'pending' as const },
                { id: 'computer' as const, status: 'pending' as const },
            ],
            action: 'none' as const,
        };
        const blocked = {
            ...preparing,
            phase: 'blocked' as const,
            rows: [
                { id: 'home' as const, status: 'complete' as const },
                { id: 'app' as const, status: 'blocked' as const },
                { id: 'computer' as const, status: 'pending' as const },
            ],
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
