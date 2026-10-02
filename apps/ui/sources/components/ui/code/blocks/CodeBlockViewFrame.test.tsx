import React from 'react';
import renderer from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installCodeBlockCommonModuleMocks } from './codeBlockTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setStringAsyncSpy = vi.fn<(text: string) => Promise<void>>(async (_text) => {});
const alertSpy = vi.fn();

installCodeBlockCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: (...args: any[]) => alertSpy(...args),
            },
        }).module;
    },
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

vi.mock('expo-clipboard', () => ({
    setStringAsync: (text: string) => setStringAsyncSpy(text),
}));

vi.mock('@/sync/store/hooks', () => ({
    useLocalSetting: () => 1,
}));

function mockPlatform(os: 'android' | 'web') {
    installCodeBlockCommonModuleMocks({
        reactNative: async () => {
            const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
            return createReactNativeWebMock({
                Platform: {
                    OS: os,
                    select: (options: any) => options?.[os] ?? options?.default ?? options?.native ?? options?.ios ?? options?.android,
                },
            });
        },
    });
}

describe('CodeBlockViewFrame', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('uses a gesture-handler ScrollView on Android so horizontal code block drags win nested gesture negotiation', async () => {
        mockPlatform('android');
        const { CodeBlockViewFrame } = await import('./CodeBlockViewFrame');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<CodeBlockViewFrame code={'x'} language={null} wrap={false} showCopyButton={false}>
                    <React.Fragment>child</React.Fragment>
                </CodeBlockViewFrame>)).tree;

        const scrollView = tree.findByType('GestureHandlerScrollView');
        expect(scrollView.props.horizontal).toBe(true);
        expect(scrollView.props.nestedScrollEnabled).toBe(true);
        expect(scrollView.props.disallowInterruption).toBe(true);
    });

    it('forwards scrollTestID when wrap is false (stable E2E locator)', async () => {
        mockPlatform('web');
        const { CodeBlockViewFrame } = await import('./CodeBlockViewFrame');

        const screen = await renderScreen(
            <CodeBlockViewFrame
                code={'x'}
                language={null}
                wrap={false}
                showCopyButton={false}
                scrollTestID="markdown-code-block-scroll"
            >
                <React.Fragment>child</React.Fragment>
            </CodeBlockViewFrame>,
        );

        const scrollView = screen.findByTestId('markdown-code-block-scroll')!;
        expect(scrollView.props.testID).toBe('markdown-code-block-scroll');
        expect(scrollView.props.horizontal).toBe(true);
        expect(scrollView.props.nestedScrollEnabled).toBe(true);
    });

    it('positions copy button absolutely when there is no header content', async () => {
        mockPlatform('web');
        const { CodeBlockViewFrame } = await import('./CodeBlockViewFrame');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<CodeBlockViewFrame code={'x'} language={null} wrap={true} showCopyButton={true}>
                    <React.Fragment>child</React.Fragment>
                </CodeBlockViewFrame>)).tree;

        const pressable = tree.findByProps({ accessibilityLabel: 'common.copy' });
        const flattened = Array.isArray(pressable.props.style) ? pressable.props.style.flat() : [pressable.props.style];
        expect(flattened.some((s: any) => s?.position === 'absolute')).toBe(true);
    });

    it.each([false, true])('keeps the code out from under an overlaid copy button (wrap=%s)', async (wrap) => {
        mockPlatform('web');
        const { CodeBlockViewFrame, CODE_BLOCK_OVERLAY_COPY_INSET } = await import('./CodeBlockViewFrame');

        const screen = await renderScreen(
            <CodeBlockViewFrame code={'happier-server --print-home-claim-code'} language={null} showHeaderRow={false} wrap={wrap} showCopyButton scrollTestID="code-viewport">
                <React.Fragment>child</React.Fragment>
            </CodeBlockViewFrame>,
        );

        // The viewport that holds the code (the scroller, or the wrapped block) ends where the button begins,
        // so a long command scrolls or wraps beside the button instead of running under it.
        const flat = (style: unknown) => (Array.isArray(style) ? style.flat(Infinity) : [style]) as Array<Record<string, unknown> | null>;
        const marginRightOf = (style: unknown) => flat(style).reduce<number>((value, entry) => (typeof entry?.marginRight === 'number' ? entry.marginRight : value), 0);
        const viewport = wrap
            ? screen.tree.root.findAll((node) => typeof node.type === 'string' && marginRightOf(node.props.style) > 0)[0] ?? null
            : screen.findByTestId('code-viewport');
        expect(CODE_BLOCK_OVERLAY_COPY_INSET).toBeGreaterThan(0);
        expect(viewport).not.toBeNull();
        expect(marginRightOf(viewport!.props.style)).toBe(CODE_BLOCK_OVERLAY_COPY_INSET);
    });

    it('gives the code the full width when the copy button sits in the header', async () => {
        mockPlatform('web');
        const { CodeBlockViewFrame } = await import('./CodeBlockViewFrame');

        const screen = await renderScreen(
            <CodeBlockViewFrame code={'x'} language={'typescript'} wrap={false} showCopyButton scrollTestID="code-viewport">
                <React.Fragment>child</React.Fragment>
            </CodeBlockViewFrame>,
        );

        const viewport = screen.findByTestId('code-viewport')!;
        const styles = (Array.isArray(viewport.props.style) ? viewport.props.style.flat(Infinity) : [viewport.props.style]) as Array<Record<string, unknown> | null>;
        expect(styles.some((style) => typeof style?.marginRight === 'number' && style.marginRight > 0)).toBe(false);
    });

    it('keeps copy button in the header when language is provided', async () => {
        mockPlatform('web');
        const { CodeBlockViewFrame } = await import('./CodeBlockViewFrame');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<CodeBlockViewFrame code={'x'} language={'typescript'} wrap={true} showCopyButton={true}>
                    <React.Fragment>child</React.Fragment>
                </CodeBlockViewFrame>)).tree;

        const pressable = tree.findByProps({ accessibilityLabel: 'common.copy' });
        const flattened = Array.isArray(pressable.props.style) ? pressable.props.style.flat() : [pressable.props.style];
        expect(flattened.some((s: any) => s?.position === 'absolute')).toBe(false);
    });

    it('keeps copy button in the header when headerLeft is provided', async () => {
        mockPlatform('web');
        const { CodeBlockViewFrame } = await import('./CodeBlockViewFrame');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(
            <CodeBlockViewFrame
                code={'x'}
                language={null}
                wrap={true}
                showCopyButton={true}
                headerLeft={<React.Fragment>header-left</React.Fragment>}
            >
                <React.Fragment>child</React.Fragment>
            </CodeBlockViewFrame>,
        )).tree;

        const pressable = tree.findByProps({ accessibilityLabel: 'common.copy' });
        const flattened = Array.isArray(pressable.props.style) ? pressable.props.style.flat() : [pressable.props.style];
        expect(flattened.some((s: any) => s?.position === 'absolute')).toBe(false);
    });

    it('can hide the header row even when a language is provided', async () => {
        mockPlatform('web');
        const { CodeBlockViewFrame } = await import('./CodeBlockViewFrame');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(
            <CodeBlockViewFrame
                code={'x'}
                language={'typescript'}
                wrap={true}
                showCopyButton={true}
                showHeaderRow={false}
            >
                <React.Fragment>child</React.Fragment>
            </CodeBlockViewFrame>,
        )).tree;

        const pressable = tree.findByProps({ accessibilityLabel: 'common.copy' });
        const flattened = Array.isArray(pressable.props.style) ? pressable.props.style.flat() : [pressable.props.style];
        expect(flattened.some((s: any) => s?.position === 'absolute')).toBe(true);
    });

    it('copies without showing a modal and shows a temporary copied state', async () => {
        setStringAsyncSpy.mockClear();
        alertSpy.mockClear();
        mockPlatform('web');

        const { CodeBlockViewFrame } = await import('./CodeBlockViewFrame');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<CodeBlockViewFrame code={'hello'} language={null} wrap={true} showCopyButton={true}>
                    <React.Fragment>child</React.Fragment>
                </CodeBlockViewFrame>)).tree;

        const iconBefore = tree.findByType('Icon') as any;
        expect(iconBefore.props.name).toBe('copy');

        const pressable = tree.findByProps({ accessibilityLabel: 'common.copy' });
        await pressTestInstanceAsync(pressable, 'common.copy');

        expect(setStringAsyncSpy).toHaveBeenCalledWith('hello');
        expect(alertSpy).toHaveBeenCalledTimes(0);

        const iconAfter = tree.findByType('Icon') as any;
        expect(iconAfter.props.name).toBe('check');
    });

    it('falls back cleanly when Typography.mono is missing from a partial module mock', async () => {
        vi.resetModules();
        mockPlatform('web');
        vi.doMock('@/constants/Typography', () => ({
            Typography: {
                default: () => ({}),
            },
        }));

        const { CodeBlockViewFrame } = await import('./CodeBlockViewFrame');

        const tree = (await renderScreen(
            <CodeBlockViewFrame code={'hello'} language={'typescript'} wrap={true} showCopyButton={false}>
                <React.Fragment>child</React.Fragment>
            </CodeBlockViewFrame>,
        )).tree;

        expect(tree.findAllByType('Text' as any).length).toBeGreaterThan(0);
    });
});
