import { describe, expect, it } from 'vitest';

import { getSessionLocalControlState, isSessionLocallyAttached } from './sessionLocalControl';
import type { Session } from '@/sync/domains/state/storageTypes';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';

describe('sessionLocalControl', () => {
    it('does not revive stopped legacy control when metadata is unavailable', () => {
        const session = createSessionFixture({ active: false, metadata: null, agentState: { controlledByUser: true } });
        expect(getSessionLocalControlState(session)).toBeNull();
        expect(isSessionLocallyAttached(session)).toBe(false);
    });

    it.each([0, 1])('uses the canonical owner view to retire live control (metadata layout %s)', (metadataLayoutVersion) => {
        const metadata = { path: '/workspace', host: 'machine', terminal: {
            mode: 'herdr' as const, controlServiceabilityV1: {
                v: 1 as const, attachmentId: 'retired-host', state: 'unknown' as const,
                observedAt: 20, retired: true,
            },
        } };
        const session = createSessionFixture({ active: true, metadataLayoutVersion,
            metadata: metadataLayoutVersion === 0 ? metadata : null,
            ...(metadataLayoutVersion === 1 ? { ownerMetadataView: metadata } : {}),
            agentState: { controlledByUser: true, localControl: {
                attached: true, topology: 'shared', remoteWritable: true, canAttach: true, canDetach: true,
            } },
        });
        expect(getSessionLocalControlState(session)).toBeNull();
        expect(isSessionLocallyAttached(session)).toBe(false);
    });

    it('does not advertise live control for a preserved but unservable terminal', () => {
        const session = createSessionFixture({ active: true,
            metadata: { path: '/workspace', host: 'machine', terminal: { mode: 'herdr', controlServiceabilityV1: {
                v: 1, attachmentId: 'preserved-host', state: 'recoverable_unservable', observedAt: 20,
            } } },
            agentState: { controlledByUser: true },
        });
        expect(getSessionLocalControlState(session)).toBeNull();
    });

    it('preserves live legacy and managed shared control', () => {
        const session = createSessionFixture({ active: true, agentState: { controlledByUser: true } });
        expect(getSessionLocalControlState(session)).toMatchObject({ attached: true, topology: 'exclusive', canDetach: true });
        session.agentState = { controlledByUser: false, localControl: {
            attached: true, topology: 'shared', remoteWritable: true, canDetach: true,
        } };
        expect(getSessionLocalControlState(session)).toMatchObject({ attached: true, topology: 'shared', canDetach: true });
    });

    it('does not infer remote writeability from shared topology', () => {
        const session = {
            active: true,
            metadata: {
                flavor: 'opencode',
            },
            agentState: {
                localControl: {
                    attached: true,
                    topology: 'shared',
                },
            },
        } as Session;

        expect(getSessionLocalControlState(session)).toEqual({
            attached: true,
            topology: 'shared',
            remoteWritable: false,
            canAttach: false,
            canDetach: false,
        });
    });

    it('does not expose local control for inactive sessions even when controlledByUser is still recorded', () => {
        const session = {
            active: false,
            metadata: {
                flavor: 'codex',
            },
            agentState: {
                controlledByUser: true,
            },
        } as Session;

        expect(getSessionLocalControlState(session)).toBeNull();
        expect(isSessionLocallyAttached(session)).toBe(false);
    });
});
