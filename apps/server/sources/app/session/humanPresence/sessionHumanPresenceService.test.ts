import type { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";

import { createSessionHumanPresenceService } from "./sessionHumanPresenceService";

describe("session human presence projection repair", () => {
    it("does not let a slow Session projection block an unrelated Session", async () => {
        const attempts: string[] = [];
        let releaseSessionA: (() => void) | undefined;
        const io = {
            in: (room: string) => ({
                fetchSockets: vi.fn(async () => {
                    attempts.push(room);
                    if (room.endsWith("session-a")) {
                        await new Promise<void>((resolve) => {
                            releaseSessionA = resolve;
                        });
                    }
                    return [];
                }),
            }),
            sockets: { sockets: new Map(), adapter: undefined },
        } as unknown as Server;
        const presence = createSessionHumanPresenceService({ io });

        try {
            presence.schedule(["session-a"]);
            await expect.poll(() => releaseSessionA).toBeTypeOf("function");

            presence.schedule(["session-b"]);
            await expect.poll(() => attempts).toContain("session-human-presence:session-b");
        } finally {
            releaseSessionA?.();
            presence.close();
        }
    });

    it("coalesces a transition queued during a failing projection behind the new backoff", async () => {
        const attempts: string[] = [];
        let rejectFirstProjection: ((error: Error) => void) | undefined;
        const io = {
            in: (room: string) => ({
                fetchSockets: vi.fn(async () => {
                    attempts.push(room);
                    if (room.endsWith("session-a")) {
                        if (attempts.length === 1) {
                            await new Promise<never>((_resolve, reject) => {
                                rejectFirstProjection = reject;
                            });
                        }
                        throw new Error("transient adapter outage");
                    }
                    return [];
                }),
            }),
            sockets: { sockets: new Map(), adapter: undefined },
        } as unknown as Server;
        const presence = createSessionHumanPresenceService({ io });

        try {
            presence.schedule(["session-a"]);
            await expect.poll(() => rejectFirstProjection).toBeTypeOf("function");

            presence.schedule(["session-a", "session-b"]);
            rejectFirstProjection!(new Error("transient adapter outage"));

            await expect.poll(() => attempts).toContain("session-human-presence:session-b");
            expect(attempts).toEqual([
                "session-human-presence:session-a",
                "session-human-presence:session-b",
            ]);
        } finally {
            presence.close();
        }
    });

    it("coalesces access-change notifications behind an active projection backoff", async () => {
        const attempts: string[] = [];
        const io = {
            in: (room: string) => ({
                fetchSockets: vi.fn(async () => {
                    attempts.push(room);
                    if (room.endsWith("session-a")) throw new Error("transient adapter outage");
                    return [];
                }),
            }),
            sockets: { sockets: new Map(), adapter: undefined },
        } as unknown as Server;
        const presence = createSessionHumanPresenceService({ io });

        try {
            presence.schedule(["session-a"]);
            await expect.poll(() => attempts).toEqual(["session-human-presence:session-a"]);

            presence.schedule(["session-a"]);
            presence.schedule(["session-a", "session-b"]);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(attempts).toEqual([
                "session-human-presence:session-a",
                "session-human-presence:session-b",
            ]);
        } finally {
            presence.close();
        }
    });
});
