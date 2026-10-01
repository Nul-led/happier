import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

describe('ActionCard', () => {
    it('keeps the complete primary action readable and operable', async () => {
        const { ActionCard } = await import('../ActionCard');
        const onPress = vi.fn();
        const screen = await renderScreen(
            <ActionCard
                testID="action-card"
                title="Install CLI"
                primaryAction={{ label: 'Connect this computer here', onPress }}
            />,
        );

        const label = screen.tree.findAllByType('Text' as never).find((node) => node.props.children === 'Connect this computer here');
        expect(label).toBeTruthy();
        expect(label?.props.numberOfLines).toBeUndefined();
        await act(async () => { screen.findByTestId('action-card-primary')?.props.onPress(); });
        expect(onPress).toHaveBeenCalledOnce();
    });

    it('renders secondary button when provided', async () => {
        const { ActionCard } = await import('../ActionCard');
        const screen = await renderScreen(
            <ActionCard
                testID="action-card"
                title="Install"
                primaryAction={{ label: 'Install', onPress: () => {} }}
                secondaryAction={{ label: 'Skip', onPress: () => {} }}
            />,
        );

        expect(screen.findByTestId('action-card-secondary')).toBeTruthy();
        const label = screen.tree.findAllByType('Text' as never).find((node) => node.props.children === 'Skip');
        expect(label).toBeTruthy();
        expect(label?.props.numberOfLines).toBeUndefined();
    });

    it('does not render secondary button when omitted', async () => {
        const { ActionCard } = await import('../ActionCard');
        const screen = await renderScreen(
            <ActionCard
                testID="action-card"
                title="Install"
                primaryAction={{ label: 'Go', onPress: () => {} }}
            />,
        );

        expect(screen.findByTestId('action-card-secondary')).toBeNull();
    });

    it('disables buttons when loading', async () => {
        const { ActionCard } = await import('../ActionCard');
        const screen = await renderScreen(
            <ActionCard
                testID="action-card"
                title="Install"
                primaryAction={{ label: 'Go', onPress: () => {} }}
                secondaryAction={{ label: 'Skip', onPress: () => {} }}
                loading
            />,
        );

        expect(screen.findByTestId('action-card-primary')?.props.accessibilityState.disabled).toBe(true);
        expect(screen.findByTestId('action-card-secondary')?.props.accessibilityState.disabled).toBe(true);
        expect(screen.findByTestId('action-card-primary')?.props.loading).toBe(true);
        expect(screen.findByTestId('action-card-secondary')?.props.loading).toBe(true);
    });

    it('description is optional', async () => {
        const { ActionCard } = await import('../ActionCard');
        const screen = await renderScreen(
            <ActionCard
                testID="action-card"
                title="No Desc"
                primaryAction={{ label: 'Go', onPress: () => {} }}
            />,
        );

        expect(screen.getTextContent()).toBe('No Desc Go');
    });
});
