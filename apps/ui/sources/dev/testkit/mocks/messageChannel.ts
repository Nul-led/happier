import { vi, type Mock } from 'vitest';

/**
 * A `MessageChannel` test double for the platform boundary hosted plugin
 * frames actually use.
 *
 * The real guest bootstrap creates a channel, keeps one port and transfers the
 * other with its `ready` envelope; every later host<->guest message rides that
 * port instead of a window `message` payload. Node's own `MessageChannel` is
 * not that boundary: it cannot be handed to a `MessageEvent` fixture, and its
 * async delivery hides the ordered retirement these hosts depend on. This
 * double keeps delivery synchronous, records both directions, and honors
 * `close()` from either end so a test can prove a retired port stops carrying
 * traffic.
 */
export type TestMessageChannel = Readonly<{
    port1: MessagePort;
    port2: MessagePort;
    port1PostMessage: Mock<(data: unknown) => void>;
    port2PostMessage: Mock<(data: unknown) => void>;
    port1Close: Mock<() => void>;
    port2Close: Mock<() => void>;
    port1Start: Mock<() => void>;
    port2Start: Mock<() => void>;
}>;

export function createTestMessageChannel(): TestMessageChannel {
    let closed = false;
    const port1PostMessage = vi.fn<(data: unknown) => void>();
    const port2PostMessage = vi.fn<(data: unknown) => void>();
    const port1Close = vi.fn<() => void>(() => { closed = true; });
    const port2Close = vi.fn<() => void>(() => { closed = true; });
    const port1Start = vi.fn<() => void>();
    const port2Start = vi.fn<() => void>();
    const first = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: port1PostMessage,
        start: port1Start,
        close: port1Close,
    };
    const second = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: port2PostMessage,
        start: port2Start,
        close: port2Close,
    };
    port1PostMessage.mockImplementation((data) => {
        if (!closed) second.onmessage?.({ data });
    });
    port2PostMessage.mockImplementation((data) => {
        if (!closed) first.onmessage?.({ data });
    });
    return Object.freeze({
        port1: first as unknown as MessagePort,
        port2: second as unknown as MessagePort,
        port1PostMessage,
        port2PostMessage,
        port1Close,
        port2Close,
        port1Start,
        port2Start,
    });
}
