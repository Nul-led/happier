import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installAgentInputCommonModuleMocks } from '@/components/sessions/agentInput/agentInputTestHelpers';

const platformBoundary = vi.hoisted(() => ({ os: 'web' }));

installAgentInputCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        const mock = await createReactNativeWebMock();
        Object.defineProperty(mock.Platform, 'OS', { configurable: true, get: () => platformBoundary.os });
        return mock;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
});

type ChipProps = React.ComponentProps<(typeof import('./AgentInputFolderChip'))['AgentInputFolderChip']>;

async function renderChip(overrides: Partial<ChipProps>) {
    const { AgentInputFolderChip } = await import('./AgentInputFolderChip');
    const onPress = vi.fn();
    const onRemove = vi.fn();
    const props: ChipProps = {
        state: { kind: 'folder', path: '~/code/happier' },
        tint: '#767676',
        chipStyle: () => ({}),
        textStyle: {},
        onPress,
        onRemove,
        ...overrides,
    };
    const screen = await renderScreen(<AgentInputFolderChip {...props} />);
    return { screen, onPress, onRemove };
}

function textsOf(node: { findAll: (predicate: (node: { type?: unknown }) => boolean) => Array<{ props: unknown }> }): unknown[] {
    return node
        .findAll((candidate) => candidate?.type === 'Text')
        .map((candidate) => (candidate.props as { children?: unknown }).children);
}

describe('AgentInputFolderChip', () => {
    afterEach(() => { platformBoundary.os = 'web'; });

    it('offers the remove accelerator when a native keyboard focuses the folder', async () => {
        platformBoundary.os = 'ios';
        const { screen, onRemove } = await renderChip({});
        await act(async () => { screen.findByTestId('agent-input-path-chip')!.props.onFocus({}); });
        const remove = screen.findByTestId('agent-input-path-chip-remove');
        expect(remove).toBeTruthy();
        expect(remove!.props.accessible).toBe(true);
        await act(async () => { remove!.props.onPress(); });
        expect(onRemove).toHaveBeenCalledOnce();
    });
    it('opens the picker from the chip and removes the folder only from ×, never both', async () => {
        const { screen, onPress, onRemove } = await renderChip({});
        const chip = screen.findByTestId('agent-input-path-chip');
        expect(chip).toBeTruthy();
        expect(textsOf(chip!)).toContain('~/code/happier');
        expect(screen.findByTestId('agent-input-path-chip-remove')!.props.accessible).toBe(false);

        await act(async () => { (chip!.props as { onPress: () => void }).onPress(); });
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(onRemove).not.toHaveBeenCalled();

        await act(async () => { chip!.props.onHoverIn(); });
        const remove = screen.findByTestId('agent-input-path-chip-remove');
        expect(remove).toBeTruthy();
        expect(remove!.props.accessible).toBe(true);
        await act(async () => { (remove!.props as { onPress: () => void }).onPress(); });
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('removes the folder from the keyboard and from the screen-reader action through the same handler', async () => {
        const { screen, onRemove } = await renderChip({});
        const chip = screen.findByTestId('agent-input-path-chip')!;
        const props = chip.props as {
            onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
            onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
            accessibilityActions?: ReadonlyArray<{ name: string; label?: string }>;
        };
        expect(props.accessibilityActions?.map((action) => action.name)).toContain('remove');

        await act(async () => { props.onKeyDown?.({ key: 'Delete', preventDefault: () => {} }); });
        await act(async () => { props.onKeyDown?.({ key: 'Backspace', preventDefault: () => {} }); });
        await act(async () => { props.onAccessibilityAction?.({ nativeEvent: { actionName: 'remove' } }); });
        expect(onRemove).toHaveBeenCalledTimes(3);
    });

    it('reads “Add folder” with no folder, and offers no × to remove what is not there', async () => {
        const { screen, onPress, onRemove } = await renderChip({ state: { kind: 'none' } });
        const chip = screen.findByTestId('agent-input-path-chip')!;
        expect(textsOf(chip)).toContain('newSession.folder.addFolder');
        expect(screen.findByTestId('agent-input-path-chip-remove')).toBeFalsy();
        await act(async () => { (chip.props as { onPress: () => void }).onPress(); });
        expect(onPress).toHaveBeenCalledTimes(1);
        await act(async () => {
            (chip.props as { onKeyDown?: (event: { key: string; preventDefault: () => void }) => void })
                .onKeyDown?.({ key: 'Delete', preventDefault: () => {} });
        });
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('never offers “Add folder” or × while the folder is loading', async () => {
        const { screen } = await renderChip({ state: { kind: 'resolving', lastKnownPath: '~/code/website' } });
        const chip = screen.findByTestId('agent-input-path-chip')!;
        expect(textsOf(chip)).toContain('~/code/website');
        expect(textsOf(chip)).not.toContain('newSession.folder.addFolder');
        expect(screen.findByTestId('agent-input-path-chip-remove')).toBeFalsy();
        expect((chip.props as { accessibilityLabel?: string }).accessibilityLabel).toBe('newSession.folder.a11y.loading');
    });

    it('is disabled with the machine’s reason while the machine is unavailable, and keeps its value', async () => {
        const { screen, onPress } = await renderChip({
            state: { kind: 'machine_unavailable', label: { kind: 'folder', path: '~/code/happier' }, reason: 'MacBook Pro is offline' },
        });
        const chip = screen.findByTestId('agent-input-path-chip')!;
        const props = chip.props as {
            disabled?: boolean;
            accessibilityState?: { disabled?: boolean };
            accessibilityHint?: string;
            onPress?: () => void;
        };
        expect(textsOf(chip)).toContain('~/code/happier');
        expect(textsOf(chip)).not.toContain('newSession.folder.addFolder');
        expect(props.disabled).toBe(true);
        expect(props.accessibilityState?.disabled).toBe(true);
        expect(props.accessibilityHint).toBe('MacBook Pro is offline');
        expect(screen.findByTestId('agent-input-path-chip-remove')).toBeFalsy();
        expect(onPress).not.toHaveBeenCalled();
    });
});
