import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props, null),
}));

vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, unknown>) => {
        if (params && Object.keys(params).length > 0) {
            return `${key}:${JSON.stringify(params)}`;
        }
        return key;
    },
}));

describe('createExecutionRunRequestedActionChip', () => {
    it("publishes a 'list' presentation collapsedOptionsPopover with a rootStep section (no flat options)", async () => {
        const { createExecutionRunRequestedActionChip } = await import('./createExecutionRunRequestedActionChip');

        const chip = createExecutionRunRequestedActionChip({
            recipient: {
                kind: 'execution_run',
                runId: 'A1',
            },
            requestedAction: { v: 1, kind: 'send_now' },
            onRequestedActionChange: () => {},
        });

        const popover = chip.collapsedOptionsPopover;
        expect(popover).toBeTruthy();
        expect(popover!.presentation).toBe('list');
        expect(popover!.rootStep).toBeTruthy();
        // The flat `options` field MUST be absent on a 'list' descriptor.
        expect((popover as Record<string, unknown>).options).toBeUndefined();

        const section = popover!.rootStep!.sections[0];
        expect(section.kind).toBe('static');
        if (section.kind !== 'static') return;
        expect(section.options.map((option) => option.id)).toEqual([
            'enqueue',
            'steer_if_active',
            'send_now',
        ]);
        expect(popover!.selectedOptionId).toBe('send_now');
    });

    it('exposes per-option onSelect callbacks that dispatch onRequestedActionChange so the overlay route fires the mutation', async () => {
        const { createExecutionRunRequestedActionChip } = await import('./createExecutionRunRequestedActionChip');

        const onRequestedActionChange = vi.fn();
        const chip = createExecutionRunRequestedActionChip({
            recipient: {
                kind: 'execution_run',
                runId: 'A1',
            },
            requestedAction: { v: 1, kind: 'enqueue' },
            onRequestedActionChange,
        });

        const section = chip.collapsedOptionsPopover!.rootStep!.sections[0];
        if (section.kind !== 'static') throw new Error('expected static section');

        const steerOption = section.options.find((option) => option.id === 'steer_if_active');
        expect(typeof steerOption?.onSelect).toBe('function');

        steerOption!.onSelect!();
        expect(onRequestedActionChange).toHaveBeenCalledWith({ v: 1, kind: 'steer_if_active' });
    });

    it('descriptor-level onSelect is a documented close-only no-op (does NOT mutate delivery state)', async () => {
        const { createExecutionRunRequestedActionChip } = await import('./createExecutionRunRequestedActionChip');

        const onRequestedActionChange = vi.fn();
        const chip = createExecutionRunRequestedActionChip({
            recipient: {
                kind: 'execution_run',
                runId: 'A1',
            },
            requestedAction: { v: 1, kind: 'enqueue' },
            onRequestedActionChange,
        });

        chip.collapsedOptionsPopover!.onSelect('steer_if_active');
        chip.collapsedOptionsPopover!.onSelect('send_now');
        expect(onRequestedActionChange).not.toHaveBeenCalled();
    });
});
