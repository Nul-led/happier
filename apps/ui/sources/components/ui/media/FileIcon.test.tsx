import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({});
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('react-native-svg', () => ({
    SvgXml: (props: any) => React.createElement('SvgXml', props),
}));

describe('FileIcon', () => {
    it('draws a line glyph tinted by the file type in trees (no filled tile)', async () => {
        const { FileIcon } = await import('./FileIcon');
        const ts = await renderScreen(<FileIcon fileName="SettingsModal.tsx" appearance="line" size={16} testID="icon" />);
        const md = await renderScreen(<FileIcon fileName="package.json" appearance="line" size={16} testID="icon" />);

        expect(ts.findAll((node) => (node.type as any) === 'SvgXml')).toHaveLength(0);
        const tsGlyph = ts.findAll((node) => node.props?.name === 'file')[0];
        const mdGlyph = md.findAll((node) => node.props?.name === 'file')[0];
        expect(tsGlyph).toBeTruthy();
        // Tinted by type: two types, two tints.
        expect(tsGlyph?.props.color).not.toBe(mdGlyph?.props.color);
    });

    it('keeps the brand tile by default', async () => {
        const { FileIcon } = await import('./FileIcon');
        const screen = await renderScreen(<FileIcon fileName="SettingsModal.tsx" size={16} />);
        expect(screen.findAll((node) => (node.type as any) === 'SvgXml').length).toBeGreaterThan(0);
    });
});
