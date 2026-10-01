import { describe, expect, it } from 'vitest';

import { normalizeLocalServiceScan } from './scanner';

describe('normalizeLocalServiceScan', () => {
    it('marks only listeners owned by exact Happier process or endpoint evidence', () => {
        const snapshot = normalizeLocalServiceScan({
            machineId: 'machine-a', now: 1_000, previous: null, workspaces: [],
            internalProcessPids: [100, 200],
            internalEndpointUrls: ['http://127.0.0.1:19364', 'https://example.com:9999', 'not a URL'],
            listeners: [
                { address: '127.0.0.1', port: 3000, protocol: 'tcp', pid: 100 },
                { address: '::1', port: 3001, protocol: 'tcp', pid: 200 },
                { address: '0.0.0.0', port: 19364, protocol: 'tcp' },
                { address: '127.0.0.1', port: 5173, protocol: 'tcp', pid: 300 },
                { address: '192.168.1.2', port: 19364, protocol: 'tcp', pid: 400 },
                { address: '127.0.0.2', port: 19364, protocol: 'tcp', pid: 400 },
                { address: '127.0.0.1', port: 9999, protocol: 'tcp', pid: 400 },
            ],
            processes: new Map([
                [100, { pid: 100, command: 'node daemon.js' }],
                [200, { pid: 200, command: 'happier session' }],
                [300, { pid: 300, ppid: 200, command: 'node happier-demo.js', cwd: '/repo/.happier' }],
                [400, { pid: 400, command: 'node web.js' }],
            ]),
        });
        expect(snapshot.entries.filter((entry) => entry.classification?.kind === 'happier').map((entry) => entry.port)).toEqual([3000, 3001, 19364]);
        expect(snapshot.entries.find((entry) => entry.port === 5173)?.classification?.kind).not.toBe('happier');
        expect(snapshot.entries.find((entry) => entry.address.kind === 'lan')?.classification?.kind).not.toBe('happier');
        expect(snapshot.entries.find((entry) => entry.address.host === '127.0.0.2')?.classification?.kind).not.toBe('happier');
        expect(snapshot.entries.find((entry) => entry.port === 9999)?.classification?.kind).not.toBe('happier');
    });

    it('normalizes adapter listeners into stable sanitized inventory entries', () => {
        const snapshot = normalizeLocalServiceScan({
            machineId: 'machine-a',
            now: 3_000,
            previous: null,
            listeners: [
                {
                    address: '127.0.0.1',
                    port: 5173,
                    protocol: 'tcp',
                    pid: 400,
                },
            ],
            processes: new Map([
                [400, { pid: 400, ppid: 300, processStartTimeMs: 1_717_171_717_000, command: 'node ./node_modules/vite/bin/vite.js --token raw-secret', cwd: '/repo/app' }],
                [300, { pid: 300, ppid: 1, processStartTimeMs: 1_717_171_710_000, command: 'npm run dev -- --token raw-secret', cwd: '/repo/app' }],
            ]),
            workspaces: [{ id: 'workspace-a', path: '/repo' }],
        });

        expect(snapshot.entries).toHaveLength(1);
        expect(snapshot.entries[0]).toMatchObject({
            id: 'machine-a:tcp:loopback:127.0.0.1:5173:pid-400:start-1717171717000',
            source: 'detected',
            state: 'listening',
            confidence: 'high',
            processOwnershipConfidence: 'medium',
            workspaceAssociationConfidence: 'high',
            classification: { kind: 'vite', displayName: 'Vite' },
        });
        expect(snapshot.entries[0]?.provenance?.process?.command).not.toContain('raw-secret');
        expect(snapshot.entries[0]?.provenance?.process?.processStartTimeMs).toBe(1_717_171_717_000);
    });

    it('treats PID reuse with a different process start-time as a fresh row', () => {
        const first = normalizeLocalServiceScan({
            machineId: 'machine-a',
            now: 1_000,
            previous: null,
            listeners: [{ address: '127.0.0.1', port: 5173, protocol: 'tcp', pid: 400 }],
            processes: new Map([[400, { pid: 400, ppid: 1, processStartTimeMs: 1_000, command: 'npm run dev', cwd: '/repo' }]]),
            workspaces: [],
        });

        const restarted = normalizeLocalServiceScan({
            machineId: 'machine-a',
            now: 2_000,
            previous: first,
            listeners: [{ address: '127.0.0.1', port: 5173, protocol: 'tcp', pid: 400 }],
            processes: new Map([[400, { pid: 400, ppid: 1, processStartTimeMs: 2_000, command: 'npm run dev', cwd: '/repo' }]]),
            workspaces: [],
        });

        const listening = restarted.entries.find((entry) => entry.state === 'listening');
        expect(listening?.id).toBe('machine-a:tcp:loopback:127.0.0.1:5173:pid-400:start-2000');
        expect(listening?.detectedAt).toBe(2_000);
        expect(first.entries[0]?.id).not.toBe(listening?.id);
    });

    it('marks missing previous entries stale during refresh instead of dropping them', () => {
        const previous = normalizeLocalServiceScan({
            machineId: 'machine-a',
            now: 1_000,
            previous: null,
            listeners: [{ address: '127.0.0.1', port: 5173, protocol: 'tcp', pid: 400 }],
            processes: new Map([[400, { pid: 400, ppid: 1, command: 'npm run dev', cwd: '/repo' }]]),
            workspaces: [],
        });

        const next = normalizeLocalServiceScan({
            machineId: 'machine-a',
            now: 2_000,
            previous,
            listeners: [],
            processes: new Map(),
            workspaces: [],
        });

        expect(next.entries).toHaveLength(1);
        expect(next.entries[0]?.state).toBe('stale');
        expect(next.entries[0]?.lastSeenAt).toBe(1_000);
    });

    it('expires stale entries through gone before dropping them', () => {
        const previous = normalizeLocalServiceScan({
            machineId: 'machine-a',
            now: 1_000,
            previous: null,
            listeners: [{ address: '127.0.0.1', port: 5173, protocol: 'tcp', pid: 400 }],
            processes: new Map([[400, { pid: 400, ppid: 1, command: 'npm run dev', cwd: '/repo' }]]),
            workspaces: [],
            staleAfterMs: 500,
        });
        const stale = normalizeLocalServiceScan({
            machineId: 'machine-a',
            now: 1_100,
            previous,
            listeners: [],
            processes: new Map(),
            workspaces: [],
            staleAfterMs: 500,
        });
        const gone = normalizeLocalServiceScan({
            machineId: 'machine-a',
            now: 1_600,
            previous: stale,
            listeners: [],
            processes: new Map(),
            workspaces: [],
            staleAfterMs: 500,
        });
        const dropped = normalizeLocalServiceScan({
            machineId: 'machine-a',
            now: 2_100,
            previous: gone,
            listeners: [],
            processes: new Map(),
            workspaces: [],
            staleAfterMs: 500,
        });

        expect(stale.entries[0]?.state).toBe('stale');
        expect(gone.entries[0]?.state).toBe('gone');
        expect(dropped.entries).toEqual([]);
    });
});
