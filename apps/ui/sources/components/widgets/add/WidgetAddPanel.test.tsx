import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';

import type { WidgetAddAsk, WidgetAddSection, WidgetAddView } from './widgetAddModel';
import { WidgetAddPanel } from './WidgetAddPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

afterEach(() => {
    standardCleanup();
});

/**
 * The one Add popover (lab `cwidgets` WG/WL, round 2): one component for every placement, a Gallery |
 * List switch, sections whose already-added entries stay in place, and every choice handed to the
 * placement's own add path.
 */
function boardSections(input: Readonly<{ pick: (id: string) => void; preview: () => void }>): WidgetAddSection[] {
    return [
        {
            id: 'plugins',
            title: 'From plugins',
            hint: 'live, with this session’s data',
            kind: 'preview',
            entries: [
                {
                    id: 'pr',
                    title: 'This branch’s PR',
                    subtitle: 'PRs & Issues',
                    icon: 'git-pull-request',
                    renderPreview: () => { input.preview(); return 'preview:pr'; },
                    onPick: () => input.pick('pr'),
                },
                {
                    id: 'conv',
                    title: 'External conversations',
                    subtitle: 'Channels',
                    icon: 'chat-circle',
                    added: true,
                    renderPreview: () => { input.preview(); return 'preview:conv'; },
                    onPick: () => input.pick('conv'),
                },
            ],
        },
        {
            id: 'make',
            title: 'Make one',
            kind: 'make',
            entries: [
                { id: 'note', title: 'Note', subtitle: 'Markdown', icon: 'note', closesOnPick: true, onPick: () => input.pick('note') },
            ],
        },
    ];
}

async function renderPanel(props: Readonly<{
    view: WidgetAddView;
    sections: WidgetAddSection[];
    ask?: WidgetAddAsk;
    onViewChange?: (view: WidgetAddView) => void;
    onRequestClose?: () => void;
}>) {
    const screen = await renderScreen(
        <WidgetAddPanel
            testID="add"
            title="Add to the board"
            hint="Everyone here sees what you add"
            searchPlaceholder="Search widgets"
            view={props.view}
            onViewChange={props.onViewChange ?? (() => {})}
            sections={props.sections}
            {...(props.ask ? { ask: props.ask } : {})}
            onRequestClose={props.onRequestClose ?? (() => {})}
        />,
    );
    await flushHookEffects({ cycles: 2 });
    return screen;
}

describe('WidgetAddPanel', () => {
    it('shows the gallery with live previews, keeps an added widget in place marked Added, and keeps open after a pick', async () => {
        const pick = vi.fn();
        const preview = vi.fn();
        const close = vi.fn();
        const screen = await renderPanel({ view: 'gallery', sections: boardSections({ pick, preview }), onRequestClose: close });
        const text = screen.getTextContent();
        expect(text).toContain('From plugins');
        expect(text).toContain('preview:pr');
        expect(text).toContain('preview:conv');
        expect(text).toContain('widgetAdd.added');

        screen.pressByTestId('add.entry.conv');
        expect(pick).not.toHaveBeenCalled();

        screen.pressByTestId('add.entry.pr');
        expect(pick).toHaveBeenCalledTimes(1);
        expect(pick).toHaveBeenCalledWith('pr');
        expect(close).not.toHaveBeenCalled();
    });

    it('closes when the pick hands focus elsewhere (a new note)', async () => {
        const pick = vi.fn();
        const close = vi.fn();
        const screen = await renderPanel({ view: 'gallery', sections: boardSections({ pick, preview: () => {} }), onRequestClose: close });
        screen.pressByTestId('add.entry.note');
        expect(pick).toHaveBeenCalledWith('note');
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('lists the same sections and Added rows in the List view without mounting any preview', async () => {
        const pick = vi.fn();
        const preview = vi.fn();
        const screen = await renderPanel({ view: 'list', sections: boardSections({ pick, preview }) });
        const text = screen.getTextContent();
        expect(text).toContain('From plugins');
        expect(text).toContain('This branch’s PR');
        expect(text).toContain('Note');
        expect(text).toContain('widgetAdd.added');
        expect(preview).not.toHaveBeenCalled();
        screen.pressByTestId('add.entry.pr');
        expect(pick).toHaveBeenCalledWith('pr');
    });

    it('switches between Gallery and List through the remembered view', async () => {
        const onViewChange = vi.fn();
        const screen = await renderPanel({ view: 'gallery', sections: boardSections({ pick: () => {}, preview: () => {} }), onViewChange });
        screen.pressByTestId('add.view:list');
        expect(onViewChange).toHaveBeenCalledWith('list');
    });

    it('narrows by search, keeping matching entries and dropping empty sections', async () => {
        const screen = await renderPanel({ view: 'list', sections: boardSections({ pick: () => {}, preview: () => {} }) });
        screen.changeTextByTestId('add.search', 'conversations');
        await flushHookEffects({ cycles: 2 });
        const text = screen.getTextContent();
        expect(text).toContain('External conversations');
        expect(text).not.toContain('This branch’s PR');
        expect(text).not.toContain('Make one');
    });

    it('drafts in the composer from the ask entry and closes, sending nothing itself', async () => {
        const ask = vi.fn();
        const close = vi.fn();
        const screen = await renderPanel({
            view: 'gallery',
            sections: boardSections({ pick: () => {}, preview: () => {} }),
            ask: { title: 'Ask the agent for a widget', draft: 'Put something on this board that shows ', note: 'Nothing is sent', onPick: ask },
            onRequestClose: close,
        });
        expect(screen.getTextContent()).toContain('Put something on this board that shows');
        screen.pressByTestId('add.ask');
        expect(ask).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });
});
