import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const capturedChrome = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
const catalog = vi.hoisted(() => ({
    projection: { generation: 1 } as Readonly<{ generation: number }> | null,
}));
const capturedControllerProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

vi.mock('@/components/appShell/plugins/AppShellPluginUiProjection', () => ({
    useAppShellPluginUiProjection: () => ({ pluginUiProjection: catalog.projection }),
}));

vi.mock('@/modal/components/card/useModalCardChrome', () => ({
    useModalCardChrome: (_setChrome: unknown, chrome: Record<string, unknown>) => {
        capturedChrome.value = chrome;
    },
}));

vi.mock('./UniversalSearchController', () => ({
    UniversalSearchController: (props: Record<string, unknown>) => {
        capturedControllerProps.value = props;
        return React.createElement('UniversalSearchController', props);
    },
}));

afterEach(() => {
    capturedChrome.value = null;
    capturedControllerProps.value = null;
    catalog.projection = { generation: 1 };
    standardCleanup();
});

describe('UniversalSearchModal', () => {
    it('uses the bounded card seam while leaving SelectionList as the sole scroll owner', async () => {
        const { UniversalSearchModal } = await import('./UniversalSearchModal');

        await renderScreen(
            <UniversalSearchModal
                commands={[]}
                onClose={vi.fn()}
                setChrome={vi.fn()}
            />,
        );

        expect(capturedChrome.value).toEqual(expect.objectContaining({
            scrollHost: 'body',
            bodyScroll: 'none',
            dimensions: { width: 800, maxHeightRatio: 0.7, size: 'lg' },
        }));
    });

    it('refreshes the open command inventory only when the canonical plugin catalog snapshot changes', async () => {
        const { UniversalSearchModal } = await import('./UniversalSearchModal');
        const initialCommands = [{ id: 'plugin-action:acme/old', title: 'Old', action: vi.fn() }];
        let currentCommands = initialCommands;
        const readCurrentCommands = vi.fn(() => currentCommands);
        const element = (
            <UniversalSearchModal
                commands={initialCommands}
                readCurrentCommands={readCurrentCommands}
                onClose={vi.fn()}
                setChrome={vi.fn()}
            />
        );
        const screen = await renderScreen(element);

        const update = async () => {
            await act(async () => {
                screen.tree.update(
                    <UniversalSearchModal
                        commands={initialCommands}
                        readCurrentCommands={readCurrentCommands}
                        onClose={vi.fn()}
                        setChrome={vi.fn()}
                    />,
                );
            });
        };

        expect(capturedControllerProps.value?.commands).toBe(initialCommands);
        expect(readCurrentCommands).toHaveBeenCalledTimes(1);

        currentCommands = [{ id: 'plugin-action:acme/new', title: 'New', action: vi.fn() }];
        await update();
        expect(capturedControllerProps.value?.commands).toBe(initialCommands);
        expect(readCurrentCommands).toHaveBeenCalledTimes(1);

        catalog.projection = { generation: 2 };
        await update();
        expect(capturedControllerProps.value?.commands).toBe(currentCommands);
        expect(readCurrentCommands).toHaveBeenCalledTimes(2);
    });
});
