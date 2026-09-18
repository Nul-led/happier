import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppState } from 'react-native';
import { SESSION_HUMAN_PRESENCE_SNAPSHOT_EVENT } from '@happier-dev/protocol/sessions';
import { attachManagedSessionHumanPresenceSocket } from './attachManagedSessionHumanPresenceSocket';
// Loaded eagerly so a runtime module-graph failure fails this test loudly instead of
// being swallowed by the adapter's deliberate additive-presence catch.
import './sessionHumanPresenceRuntime';
import { sessionHumanPresenceStore } from './sessionHumanPresenceStore';
import { markSessionSurfaceHidden, markSessionSurfaceVisible } from '../sessionSurfaceVisibility';

/** Real JWT-shaped authenticated subject; the adapter must read the Account from it. */
function token(accountId: string): string {
    return `e30.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64')}.signature`;
}

function managedSocket() {
    const handlers = new Map<string, (payload: unknown) => void>();
    const emitted: Array<[string, unknown]> = [];
    const connectedListeners = new Set<() => void>();
    const socket = {
        connected: true,
        emit: (event: string, payload: unknown) => { emitted.push([event, payload]); },
        on: (event: string, handler: (payload: unknown) => void) => { handlers.set(event, handler); },
        off: (event: string) => { handlers.delete(event); },
        timeout: () => ({
            emitWithAck: async (event: string, payload: unknown) => {
                emitted.push([event, payload]);
                const { sessionIds } = payload as { sessionIds: string[] };
                return { v: 1, ok: true, admittedSessionIds: sessionIds };
            },
        }),
    };
    const transport = {
        isConnected: () => socket.connected,
        onConnected: (listener: () => void) => { connectedListeners.add(listener); return () => connectedListeners.delete(listener); },
        onDisconnected: () => () => {},
    };
    return {
        emitted, socket, transport, handlers,
        snapshot: (payload: unknown) => handlers.get(SESSION_HUMAN_PRESENCE_SNAPSHOT_EVENT)?.(payload),
    };
}

const cleanup: Array<() => void> = [];
beforeAll(() => {
    vi.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove() {} }) as never);
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
});
afterEach(() => { cleanup.splice(0).reverse().forEach((dispose) => dispose()); });
/** The adapter defers its runtime import, so settling needs real task turns. */
async function settle() { for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); }

describe('managed Home socket presence attachment', () => {
    it('declares only its own Home surfaces over the supplied carrier and excludes the token Account', async () => {
        // Two Homes with the same Session id: the concurrent/Iroh carrier for Home B must
        // never carry Home A's declaration, and neither may borrow the focused Home socket.
        markSessionSurfaceVisible('shared-session', 'home-a');
        markSessionSurfaceVisible('shared-session', 'home-b');
        markSessionSurfaceVisible('only-b', 'home-b');
        cleanup.push(() => {
            markSessionSurfaceHidden('shared-session', 'home-a');
            markSessionSurfaceHidden('shared-session', 'home-b');
            markSessionSurfaceHidden('only-b', 'home-b');
        });
        const secondary = managedSocket();
        cleanup.push(attachManagedSessionHumanPresenceSocket({
            serverId: 'home-b',
            token: token('self'),
            socket: secondary.socket as never,
            transport: secondary.transport as never,
        }));
        await settle();
        expect(secondary.emitted).toEqual([
            ['session-human-presence:visible-replace', { v: 1, sessionIds: ['only-b', 'shared-session'] }],
        ]);
        secondary.snapshot({
            v: 1, sessionId: 'shared-session', observedAt: 7,
            viewers: [
                { account: { kind: 'account', accountId: 'self', firstName: 'Me', lastName: null, username: null, avatarUrl: null }, typing: false },
                { account: { kind: 'account', accountId: 'peer', firstName: 'Peer', lastName: null, username: null, avatarUrl: null }, typing: true },
            ],
        });
        expect(sessionHumanPresenceStore.read({ serverId: 'home-b', sessionId: 'shared-session' })).toMatchObject({
            status: 'live', viewers: [{ account: { accountId: 'peer' }, typing: true }],
        });
        // Home A never attached, so its identically named Session stays unobserved.
        expect(sessionHumanPresenceStore.read({ serverId: 'home-a', sessionId: 'shared-session' }).status).toBe('unavailable');
    });

    it('never declares presence for an unauthenticated carrier', async () => {
        const anonymous = managedSocket();
        const listener = vi.fn();
        anonymous.socket.on = listener;
        cleanup.push(attachManagedSessionHumanPresenceSocket({
            serverId: 'home-c',
            token: 'not-a-token',
            socket: anonymous.socket as never,
            transport: anonymous.transport as never,
        }));
        await settle();
        expect(anonymous.emitted).toEqual([]);
        expect(listener).not.toHaveBeenCalled();
    });
});
