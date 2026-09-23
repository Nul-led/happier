import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storage } from '@/sync/domains/state/storage';
import { handleDeleteSessionSocketUpdate } from './syncSessions';

const SESSION_ID = 's_shared';
const HOME_A = 'home-a';
const HOME_B = 'home-b';

function createTeardownSpies() {
    return {
        dropSocketSessionWork: vi.fn(),
        invalidateSessionHydration: vi.fn(),
        resetSessionTranscriptState: vi.fn(),
        deleteSession: vi.fn(),
        removeSessionEncryption: vi.fn(),
        removeProjectManagerSession: vi.fn(),
        clearScmStatusForSession: vi.fn(),
        log: { log: vi.fn() },
    };
}

describe('handleDeleteSessionSocketUpdate Home scoping', () => {
    beforeEach(() => {
        storage.setState({
            sessions: { [SESSION_ID]: { id: SESSION_ID, serverId: HOME_A } },
        } as never);
    });

    it('keeps the carrier teardown out of another Home deletion for the same Session id', () => {
        const spies = createTeardownSpies();

        handleDeleteSessionSocketUpdate({ sessionId: SESSION_ID, serverId: HOME_B, ...spies });

        // The row on Home B still goes; nothing that belongs to Home A's carrier may.
        expect(spies.deleteSession).toHaveBeenCalledWith(SESSION_ID, HOME_B);
        expect(spies.invalidateSessionHydration).not.toHaveBeenCalled();
        expect(spies.resetSessionTranscriptState).not.toHaveBeenCalled();
        expect(spies.removeSessionEncryption).not.toHaveBeenCalled();
        expect(spies.removeProjectManagerSession).not.toHaveBeenCalled();
        expect(spies.clearScmStatusForSession).not.toHaveBeenCalled();
        // The socket's bare-id queues belong to whichever Home owns the carrier, so a
        // non-carrier deletion must not drop Home A's admitted-but-unflushed work.
        expect(spies.dropSocketSessionWork).toHaveBeenCalledWith(SESSION_ID, false);
    });

    it('retires the carrier when the deleting Home owns it', () => {
        const spies = createTeardownSpies();

        handleDeleteSessionSocketUpdate({ sessionId: SESSION_ID, serverId: HOME_A, ...spies });

        expect(spies.deleteSession).toHaveBeenCalledWith(SESSION_ID, HOME_A);
        expect(spies.invalidateSessionHydration).toHaveBeenCalledWith(SESSION_ID);
        expect(spies.resetSessionTranscriptState).toHaveBeenCalledWith(SESSION_ID);
        expect(spies.removeSessionEncryption).toHaveBeenCalledWith(SESSION_ID);
        expect(spies.removeProjectManagerSession).toHaveBeenCalledWith(SESSION_ID);
        // The SCM sync is registered under the carrier's exact Home key, so the
        // canonical cleanup has to address that Home or the mapping survives.
        expect(spies.clearScmStatusForSession).toHaveBeenCalledWith(SESSION_ID, HOME_A);
        expect(spies.dropSocketSessionWork).toHaveBeenCalledWith(SESSION_ID, true);
    });

    it('retires the carrier for a Home-agnostic deletion', () => {
        const spies = createTeardownSpies();

        handleDeleteSessionSocketUpdate({ sessionId: SESSION_ID, serverId: null, ...spies });

        expect(spies.deleteSession).toHaveBeenCalledWith(SESSION_ID, null);
        expect(spies.resetSessionTranscriptState).toHaveBeenCalledWith(SESSION_ID);
        expect(spies.removeSessionEncryption).toHaveBeenCalledWith(SESSION_ID);
        // No Home was addressed, so the carrier's own Home is the only key the
        // SCM owner can be cleared under.
        expect(spies.clearScmStatusForSession).toHaveBeenCalledWith(SESSION_ID, HOME_A);
    });
});
