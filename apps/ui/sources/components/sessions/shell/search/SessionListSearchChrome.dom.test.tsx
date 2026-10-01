/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installSessionShellCommonModuleMocks } from '../sessionShellTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => true,
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: Readonly<{ trigger?: (input: { toggle: () => void }) => React.ReactNode }>) => (
        <>{props.trigger?.({ toggle: () => undefined })}</>
    ),
}));

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'span', Octicons: 'span' }));
vi.mock('expo-image', () => ({ Image: 'img' }));

installSessionShellCommonModuleMocks({
    reactNative: async () => await vi.importActual('react-native-web'),
    storage: async () => ({
        useLocalSettingMutable: () => [undefined, vi.fn()] as const,
    }),
});

const { SessionListSearchChrome } = await import('./SessionListSearchChrome');

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let latestQuery = '';

function Harness() {
    const [query, setQuery] = React.useState('');
    latestQuery = query;
    return <SessionListSearchChrome searchQuery={query} onSearchQueryChange={setQuery} />;
}

const byTestId = (testID: string) => container.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
const input = () => byTestId('session-list-search-input') as HTMLInputElement | null;

async function openSearch(): Promise<HTMLElement> {
    const toggle = byTestId('session-list-search-trigger');
    if (!toggle) throw new Error('missing search toggle');
    await act(async () => { toggle.focus(); toggle.click(); });
    await vi.waitFor(() => expect(input()).not.toBeNull());
    return toggle;
}

async function typeQuery(text: string) {
    const field = input();
    if (!field) throw new Error('missing input');
    await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(field, text);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('SessionListSearchChrome (DOM)', () => {
    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => { root.render(<Harness />); });
    });
    afterEach(async () => {
        await act(async () => { root.unmount(); });
        container.remove();
        vi.restoreAllMocks();
    });

    it('opens focused, and Escape closes it, clears the query and returns focus to the search button', async () => {
        const toggle = await openSearch();
        await vi.waitFor(() => expect(document.activeElement).toBe(input()));
        await typeQuery('vec');
        expect(latestQuery).toBe('vec');

        await act(async () => {
            input()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });

        await vi.waitFor(() => expect(input()).toBeNull());
        expect(latestQuery).toBe('');
        expect(document.activeElement).toBe(toggle);
    });

    it('keeps the header icon buttons compact under a precise pointer', async () => {
        // jsdom reports no coarse pointer and no touch points: a desktop browser with a mouse.
        await openSearch();
        for (const testID of ['session-list-search-trigger', 'session-list-view-options-trigger']) {
            const button = byTestId(testID);
            if (!button) throw new Error(`missing ${testID}`);
            expect(getComputedStyle(button).height).toBe('30px');
            expect(getComputedStyle(button).width).toBe('30px');
        }
        // The field's close button is a small square inside the field, not a 44px touch frame.
        const close = byTestId('session-list-search-close');
        if (!close) throw new Error('missing close');
        expect(getComputedStyle(close).height).toBe('20px');
    });

    it('closes from the trailing close button and returns focus to the search button', async () => {
        const toggle = await openSearch();
        await typeQuery('vec');
        const close = byTestId('session-list-search-close');
        expect(close?.getAttribute('aria-label')).toBe('sessionsList.closeSearch');

        await act(async () => { close?.click(); });

        await vi.waitFor(() => expect(input()).toBeNull());
        expect(latestQuery).toBe('');
        expect(document.activeElement).toBe(toggle);
    });
});
