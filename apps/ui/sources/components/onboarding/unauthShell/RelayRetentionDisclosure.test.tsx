import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

describe('RelayRetentionDisclosure', () => {
    it('states what the Home deletes when its policy answered', async () => {
        const { RelayRetentionDisclosure } = await import('./RelayRetentionDisclosure');
        const screen = await renderScreen(
            <RelayRetentionDisclosure disclosure={{ kind: 'summary', summary: 'This Home cleans up subagent transcripts after 7 days.' }} />,
        );
        expect(screen.getTextContent()).toContain('This Home cleans up subagent transcripts after 7 days.');
        expect(screen.findByTestId('relay-retention-disclosure-retry')).toBeNull();
    });

    it('says it could not check retention, with a quiet Retry, rather than falling silent', async () => {
        const retry = vi.fn();
        const { RelayRetentionDisclosure } = await import('./RelayRetentionDisclosure');
        const screen = await renderScreen(<RelayRetentionDisclosure disclosure={{ kind: 'unreadable', retry }} />);

        expect(screen.getTextContent()).toContain('server.retention.disclosureUnreadable');
        await screen.pressByTestIdAsync('relay-retention-disclosure-retry');
        expect(retry).toHaveBeenCalledTimes(1);
    });
});
