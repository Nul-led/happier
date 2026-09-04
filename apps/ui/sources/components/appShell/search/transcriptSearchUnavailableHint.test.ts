import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ t: (key: string) => key }));

describe('transcriptSearchUnavailableHint', () => {
    it.each([
        ['home_indexing', 'memorySearchSettings.status.indexing'],
        ['daemon_no_target', 'errors.daemonUnavailableBody'],
        ['daemon_unavailable', 'errors.daemonUnavailableBody'],
        ['home_unavailable', 'memorySearchSettings.status.unavailableLight'],
        ['home_unknown', 'memorySearchSettings.status.unavailableLight'],
        ['memory_disabled', 'memorySearchSettings.disabled.footer'],
    ])('maps %s to stable contextual status copy', async (reason, expectedKey) => {
        const { transcriptSearchUnavailableHint } = await import('./transcriptSearchUnavailableHint');
        expect(transcriptSearchUnavailableHint(reason)).toBe(expectedKey);
    });
});
