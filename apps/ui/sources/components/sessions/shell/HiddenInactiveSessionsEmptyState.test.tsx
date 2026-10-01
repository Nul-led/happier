import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pressTestInstanceAsync, renderScreen, standardCleanup } from '@/dev/testkit';

import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const hideInactiveSessionsState = vi.hoisted(() => ({ value: true as boolean, writes: [] as boolean[] }));
const openArchivedSessions = vi.hoisted(() => vi.fn());

vi.mock('./useSessionListNavigationActions', () => ({
    useSessionListNavigationActions: () => ({ handleOpenArchivedSessions: openArchivedSessions }),
}));

installSessionShellCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSettingMutable: (key: string) => [
                key === 'hideInactiveSessions' ? hideInactiveSessionsState.value : null,
                (next: boolean) => {
                    hideInactiveSessionsState.writes.push(next);
                },
            ],
        });
    },
});

describe('HiddenInactiveSessionsEmptyState', () => {
    afterEach(() => {
        hideInactiveSessionsState.writes = [];
        openArchivedSessions.mockReset();
        standardCleanup();
    });

    it('says it in one line on the rows\' edge instead of a page-size tile', async () => {
        const { HiddenInactiveSessionsEmptyState } = await import('./HiddenInactiveSessionsEmptyState');
        const screen = await renderScreen(<HiddenInactiveSessionsEmptyState />);
        expect(screen.findByTestId('sessions-hidden-inactive-empty-state')).toBeTruthy();
        expect(screen.findByTestId('sessions-hidden-inactive-empty-state-list')).toBeNull();
        expect(screen.findByTestId('sessions-hidden-inactive-empty-state-description')).toBeNull();
    });

    it('offers the canonical inactive-visibility recovery beside the archived destination', async () => {
        const { HiddenInactiveSessionsEmptyState } = await import('./HiddenInactiveSessionsEmptyState');
        const screen = await renderScreen(<HiddenInactiveSessionsEmptyState />);

        // The archived destination hosts the archived corpus; inactive Sessions live in
        // the active corpus behind the canonical Account preference.
        await pressTestInstanceAsync(
            screen.findByTestId('sessions-hidden-inactive-empty-state-show-inactive')!,
            'show inactive sessions',
        );
        expect(hideInactiveSessionsState.writes).toEqual([false]);
        expect(openArchivedSessions).not.toHaveBeenCalled();

        await pressTestInstanceAsync(
            screen.findByTestId('sessions-hidden-inactive-empty-state-open-archived')!,
            'open archived sessions',
        );
        expect(openArchivedSessions).toHaveBeenCalledTimes(1);
    });
});
