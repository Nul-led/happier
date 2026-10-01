import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installUiListsCommonModuleMocks } from './uiListsTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installUiListsCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: (values: any) => values?.default ?? values?.web ?? values?.ios ?? values?.android,
            },
            AppState: {
                addEventListener: () => ({ remove: () => {} }),
            },
            Pressable: 'Pressable',
            Text: 'Text',
            View: 'View',
        });
    },
});

vi.mock('@/constants/Typography', () => ({
  Typography: { default: () => ({}) },
}));

vi.mock('@/components/ui/text/Text', async () => {
    const { createUiTextModuleMock } = await import('@/dev/testkit/mocks/uiText');
    return createUiTextModuleMock();
});

describe('SelectableRow (web cursor)', () => {
  it('exposes simple web action rows as buttons with clean labels', async () => {
    const { SelectableRow } = await import('./SelectableRow');

    const screen = await renderScreen(
        <SelectableRow testID="selectable-row-role" title="Row" subtitle="More context" onPress={() => {}} />,
    );
    const root = screen.findAll((node) => (
        node.props?.testID === 'selectable-row-role' && typeof node.props?.style === 'function'
    ))[0];
    expect(root).toBeTruthy();
    expect(root?.props?.accessibilityRole).toBeUndefined();
    expect(root?.props?.role).toBe('button');
    expect(root?.props?.accessibilityLabel).toBe('Row. More context');
  });

  it('keeps a row with no action out of the tab order and unannounced as a button', async () => {
    const { SelectableRow } = await import('./SelectableRow');

    const screen = await renderScreen(
        <SelectableRow testID="selectable-row-inert" title="Your account" subtitle="Signed in to this Home" />,
    );
    const root = screen.findAll((node) => (
        node.props?.testID === 'selectable-row-inert' && typeof node.props?.style === 'function'
    ))[0];
    expect(root).toBeTruthy();
    expect(root?.props?.role).toBeUndefined();
    expect(root?.props?.focusable).toBe(false);
  });

  it('lays the subtitle out the same way with or without a leading status mark', async () => {
    const { SelectableRow } = await import('./SelectableRow');
    const subtitleLine = async (subtitleLeading?: React.ReactNode) => {
        const screen = await renderScreen(
            <SelectableRow title="Row" subtitle="Line" subtitleLeading={subtitleLeading} onPress={() => {}} />,
        );
        const text = screen.findAll((node) => node.props?.children === 'Line' && typeof node.type !== 'string')[0];
        return flattenStyle(text?.parent?.props?.style);
    };
    const plain = await subtitleLine();
    const marked = await subtitleLine(<Dot />);
    expect(plain).toEqual(marked);
  });

  it('uses a not-allowed cursor when disabled', async () => {
    const { SelectableRow } = await import('./SelectableRow');

    const screen = await renderScreen(
        <SelectableRow testID="selectable-row-cursor" title="Row" disabled onPress={() => {}} />,
    );
    const styleSource = screen.findAll((node) => (
        node.props?.testID === 'selectable-row-cursor' && typeof node.props?.style === 'function'
    ))[0];
    const styleFn = styleSource?.props.style;
    expect(typeof styleFn).toBe('function');

    const resolved = styleFn({ pressed: false });
    const styles = Array.isArray(resolved) ? resolved : [resolved];
    expect(styles.some((s: any) => s && typeof s === 'object' && s.cursor === 'not-allowed')).toBe(true);
  });
});

function Dot() {
    return null;
}

function flattenStyle(style: unknown): Record<string, unknown> {
    const list = Array.isArray(style) ? style.flat(Infinity) : [style];
    return Object.assign({}, ...list.filter((entry) => entry && typeof entry === 'object'));
}
