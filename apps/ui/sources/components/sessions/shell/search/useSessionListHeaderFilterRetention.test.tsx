import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';

import {
    clearSessionListHeaderFilterRetentionForTests,
    useSessionListHeaderFilterRetention,
} from './useSessionListHeaderFilterRetention';

afterEach(() => {
    clearSessionListHeaderFilterRetentionForTests();
    standardCleanup();
});

describe('useSessionListHeaderFilterRetention', () => {
    it('retires the visible query synchronously when the Account/list-source key changes', async () => {
        const hook = await renderHook(
            (retentionKey: string) => useSessionListHeaderFilterRetention(retentionKey),
            { initialProps: 'account-a:list-source-a:all' },
        );

        await act(async () => {
            hook.getCurrent().setSearchQuery('private-account-a-query');
        });
        expect(hook.getCurrent().searchQuery).toBe('private-account-a-query');

        const switched = await hook.rerender('account-b:list-source-b:all');

        expect(switched.searchQuery).toBe('');
        expect(switched.selectedHeaderTags).toEqual([]);

        const switchedBack = await hook.rerender('account-a:list-source-a:all');
        expect(switchedBack.searchQuery).toBe('');
    });
});
