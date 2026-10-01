import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installSessionSubagentCommonModuleMocks } from '@/components/sessions/agents/sessionSubagentTestHelpers';

import type { WorkItem, WorkProjection, WorkStatus } from './workProjection';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

installSessionSubagentCommonModuleMocks();

function report(sessionId: string, status: WorkStatus): WorkItem {
    return {
        key: `session:${sessionId}`,
        kind: 'session',
        title: sessionId,
        agentId: null,
        facts: [],
        parentKey: null,
        level: 0,
        status,
        progress: null,
        open: { kind: 'session', sessionId },
    };
}

describe('SessionWorkMapView', () => {
    it('lets the shared treatment ring every node by its tone, a stalled report as much as one that needs you', async () => {
        // The mocks install at run time, so the renderer loads after them (a cold import is slow under load).
        const { SessionWorkMapView } = await import('./SessionWorkMapView');
        const { projectSessionWorkMap } = await import('./workMapProducer');
        const { workStatusSurfaceStyle } = await import('@/components/work/status/workStatusTreatment');
        const sessions = [
            report('stalled', { bucket: 'offline', tone: 'attention', word: 'Last seen 3h ago' }),
            report('asks', { bucket: 'needs_you', tone: 'attention', word: 'Needs your permission' }),
            report('broke', { bucket: 'needs_you', tone: 'danger', word: 'Error' }),
            report('busy', { bucket: 'working', tone: 'neutral', word: 'Working' }),
        ];
        const projection: WorkProjection = {
            sessions,
            workflows: [],
            backgroundRuns: [],
            agents: [],
            summary: { outstanding: 4, needsYou: 2, stalled: 1, sessions: 4, runs: 0 },
        };
        const map = projectSessionWorkMap({ leadSessionId: 'lead', leadTitle: 'Lead', projection });
        const screen = await renderScreen(
            <SessionWorkMapView map={map} projection={projection} testIDPrefix="work-map" onOpenItem={vi.fn()} />,
        );

        const nodeStyles = (sessionId: string) => {
            const node = screen.findByTestId(`work-map-node-session:${sessionId}`);
            expect(node, sessionId).not.toBeNull();
            const style = node!.props.style;
            return [typeof style === 'function' ? style({ pressed: false }) : style].flat(Infinity);
        };

        // The shared map draws the one treatment (equal ring and tint, not necessarily the same entry).
        expect(nodeStyles('stalled')).toContainEqual(workStatusSurfaceStyle('attention'));
        expect(nodeStyles('asks')).toContainEqual(workStatusSurfaceStyle('attention'));
        expect(nodeStyles('broke')).toContainEqual(workStatusSurfaceStyle('danger'));
        const busy = nodeStyles('busy');
        expect(busy).not.toContainEqual(workStatusSurfaceStyle('attention'));
        expect(busy).not.toContainEqual(workStatusSurfaceStyle('danger'));
        // The lead carries no state of its own (S-6).
        expect(nodeStyles('lead')).not.toContainEqual(workStatusSurfaceStyle('attention'));
    }, 180_000);
});
