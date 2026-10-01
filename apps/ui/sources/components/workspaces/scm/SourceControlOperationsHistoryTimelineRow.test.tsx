import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
import { SourceControlOperationsHistoryTimelineRow } from './SourceControlOperationsHistoryTimelineRow';

describe('SourceControlOperationsHistoryTimelineRow', () => {
    const theme = {
        colors: {
            text: { primary: '#fff', secondary: '#aaa', link: '#09f' },
            surface: { base: '#111', inset: '#222' },
            border: { default: '#333' },
            input: { background: '#111' },
        },
    } as any;

    it('exposes a readable accessibility label on the commit row', async () => {
        const timestamp = new Date('2026-04-10T11:59:00.000Z').getTime();
        const screen = await renderScreen(
            <SourceControlOperationsHistoryTimelineRow
                theme={theme}
                entry={{
                    sha: 'abc123',
                    shortSha: 'abc123',
                    authorName: 'Leeroy',
                    authorEmail: 'leeroy@example.com',
                    timestamp,
                    subject: 'Fix mobile cockpit history',
                    body: '',
                }}
                isHead={true}
                showTrailingLine={false}
                onOpenCommit={() => {}}
            />,
        );

        const row = screen.root.findByProps({ testID: 'scm-commit-entry-abc123' });
        expect(row.props.accessibilityLabel).toContain('Fix mobile cockpit history');
        expect(row.props.accessibilityLabel).toContain('Leeroy');
        expect(String(row.props.accessibilityLabel)).not.toContain('1m');
    });

    it('reads as a timeline: when it happened on the left, before the commit', async () => {
        const timestamp = Date.now() - 60_000;
        const screen = await renderScreen(
            <SourceControlOperationsHistoryTimelineRow
                theme={theme}
                entry={{ sha: 'def456', shortSha: 'def456', authorName: 'Ana', authorEmail: 'ana@example.com', timestamp, subject: 'Load settings lazily', body: '' }}
                isHead={false}
                showTrailingLine
                onOpenCommit={() => {}}
            />,
        );
        const gutter = screen.findByTestId('scm-commit-entry-def456-when');
        expect(gutter).not.toBeNull();
        const text = screen.getTextContent();
        expect(text.indexOf(new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))).toBeGreaterThanOrEqual(0);
    });
});

