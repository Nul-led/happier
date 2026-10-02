/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { resolveDesktopWindowTitlebarMouseAction } from './DesktopWindowDragRegion';

describe('resolveDesktopWindowTitlebarMouseAction (title strip tabs)', () => {
    it('lets a tab in the title strip take the press while the gaps beside it still move the window', () => {
        const strip = document.createElement('div');
        const tablist = document.createElement('div');
        tablist.setAttribute('role', 'tablist');
        const tab = document.createElement('div');
        tab.setAttribute('role', 'tab');
        const title = document.createElement('span');
        tab.appendChild(title);
        tablist.appendChild(tab);
        strip.appendChild(tablist);

        expect(resolveDesktopWindowTitlebarMouseAction({ button: 0, buttons: 1, detail: 1, target: title })).toBe('none');
        expect(resolveDesktopWindowTitlebarMouseAction({ button: 0, buttons: 1, detail: 1, target: tablist })).toBe('drag');
        expect(resolveDesktopWindowTitlebarMouseAction({ button: 0, buttons: 1, detail: 2, target: strip })).toBe('toggleMaximize');
    });

    it('honors a titlebar gesture already consumed by another chrome region or a child control', () => {
        const strip = document.createElement('div');
        expect(resolveDesktopWindowTitlebarMouseAction({
            button: 0, buttons: 1, detail: 2, target: strip, defaultPrevented: true,
        })).toBe('none');
    });
});
