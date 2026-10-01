import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleApiTokenSocketExpiry } from "./socket";

describe("API-token viewer expiry", () => {
    afterEach(() => vi.useRealTimers());

    it("keeps long-lived credentials connected through the timer range and disconnects at expiry", () => {
        vi.useFakeTimers();
        const disconnect = vi.fn();
        const socket = { disconnect, once: vi.fn() };
        const firstTimerRange = 2_147_483_647;
        scheduleApiTokenSocketExpiry(socket as never, new Date(Date.now() + firstTimerRange + 10));
        vi.advanceTimersByTime(firstTimerRange + 9);
        expect(disconnect).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(disconnect).toHaveBeenCalledWith(true);
    });

    it("clears the expiry timer when the viewer disconnects", () => {
        vi.useFakeTimers();
        const disconnect = vi.fn();
        let cleanup: (() => void) | undefined;
        const socket = { disconnect, once: (_event: string, listener: () => void) => { cleanup = listener; } };
        scheduleApiTokenSocketExpiry(socket as never, new Date(Date.now() + 10));
        cleanup?.();
        vi.advanceTimersByTime(10);
        expect(disconnect).not.toHaveBeenCalled();
    });
});
