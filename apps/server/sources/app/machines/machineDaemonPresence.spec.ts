import { describe, expect, it } from "vitest";

import { getMachineDaemonPresenceInventory, readMachineDaemonSocketIdentity } from "./machineDaemonPresence";

describe("exact Machine socket identity and inventory", () => {
    it("accepts ordinary machine sockets without reserved installation proof", () => {
        expect(readMachineDaemonSocketIdentity({ userId: "alice", clientType: "machine-scoped", machineId: "machine-a" }))
            .toEqual({ accountId: "alice", machineId: "machine-a" });
        expect(readMachineDaemonSocketIdentity({ userId: "alice", clientType: "session-scoped", machineId: "machine-a" })).toBeNull();
        expect(readMachineDaemonSocketIdentity({ userId: "alice", clientType: "user-scoped", machineId: "machine-a" })).toBeNull();
    });

    it("collapses duplicates and excludes foreign and non-machine sockets", async () => {
        const sockets = [
            { data: { userId: "alice", clientType: "machine-scoped", machineId: "machine-a" } },
            { data: { userId: "alice", clientType: "machine-scoped", machineId: "machine-a" } },
            { data: { userId: "bob", clientType: "machine-scoped", machineId: "machine-b" } },
            { data: { userId: "alice", clientType: "session-scoped", machineId: "machine-c" } },
        ];
        const io = { in: (room: string) => {
            expect(room).toBe("user:alice");
            return { fetchSockets: async () => sockets };
        } };
        expect(await getMachineDaemonPresenceInventory({ accountId: "alice", io }))
            .toEqual({ state: "known", machineIds: new Set(["machine-a"]) });
    });

    it("distinguishes an unavailable inventory from a known empty room", async () => {
        expect(await getMachineDaemonPresenceInventory({ accountId: "alice", io: {
            in: () => ({ fetchSockets: async () => { throw new Error("adapter unavailable"); } }),
        } })).toEqual({ state: "unavailable" });
        expect(await getMachineDaemonPresenceInventory({ accountId: "alice", io: {
            in: () => ({ fetchSockets: async () => [] }),
        } })).toEqual({ state: "known", machineIds: new Set() });
    });
});
