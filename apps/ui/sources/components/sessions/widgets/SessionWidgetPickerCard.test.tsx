import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { SessionWidgetPickerCard } from './SessionWidgetPickerCard';
import type { SessionWidgetCandidate } from './sessionWidgetCatalog';

const CANDIDATE: SessionWidgetCandidate = Object.freeze({
    surface: Object.freeze({ pluginId: 'acme.review', localId: 'review-status-widget' }),
    title: 'Review status',
    pluginName: 'Review Assistant',
    sharedPluginName: false,
    icon: 'article',
});

describe('SessionWidgetPickerCard', () => {
    beforeEach(() => {
        standardCleanup();
    });

    it('renders only the policy-admitted candidates supplied by the Board owner', async () => {
        const onAdd = vi.fn();
        const screen = await renderScreen(
            <SessionWidgetPickerCard
                candidates={[CANDIDATE]}
                onAdd={onAdd}
                onCancel={vi.fn()}
            />,
        );

        const row = screen.findByTestId('session-widget-picker-candidate-acme.review-review-status-widget');
        expect(row).toBeTruthy();
        await act(async () => { row?.props.onPress?.(); });
        expect(onAdd).toHaveBeenCalledWith({
            surface: { pluginId: 'acme.review', localId: 'review-status-widget' },
            title: 'Review status',
        });
    });

    it('shows the truthful empty state for the same empty selection that hides the Add entry', async () => {
        const screen = await renderScreen(
            <SessionWidgetPickerCard
                candidates={[]}
                onAdd={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        expect(screen.findByTestId('session-widget-picker-empty')).toBeTruthy();
        expect(screen.findByTestId('session-widget-picker-candidate-acme.review-review-status-widget')).toBeNull();
    });
});
