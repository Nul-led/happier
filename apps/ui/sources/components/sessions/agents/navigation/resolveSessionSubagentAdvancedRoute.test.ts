import { describe, expect, it } from 'vitest';

import type { SessionSubagent } from '@/sync/domains/session/subagents/types';

import { resolveSessionSubagentAdvancedRoute } from './resolveSessionSubagentAdvancedRoute';

describe('resolveSessionSubagentAdvancedRoute', () => {
    it('keeps the exact Home on a Run route', () => {
        const subagent = {
            id: 'execution_run:run_1',
            kind: 'execution_run',
            status: 'running',
            display: { title: 'Run' },
            transcript: {},
            recipient: { kind: 'execution_run', runId: 'run_1' },
            runRef: { runId: 'run_1' },
            capabilities: {
                canOpen: true,
                canSend: true,
                canStop: true,
                canLaunchChild: false,
                canDelete: false,
                canOpenAdvancedRun: true,
            },
            timestamps: {},
        } satisfies SessionSubagent;

        expect(resolveSessionSubagentAdvancedRoute({
            serverId: 'https://home.example.test:8443',
            sessionId: 'same/session',
            subagent,
        })).toBe('/session/same%2Fsession/runs/run_1?serverId=https%3A%2F%2Fhome.example.test%3A8443');
    });
});
