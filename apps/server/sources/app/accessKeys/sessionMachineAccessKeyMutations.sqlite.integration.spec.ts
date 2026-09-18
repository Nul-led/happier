import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx, type Tx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import {
    createSessionMachineAccessKeyInTx,
    readSessionMachineBindingStateInTx,
    updateSessionMachineAccessKeyDataInTx,
} from "./sessionMachineAccessKeyMutations";

describe("session/machine AccessKey mutations (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-session-machine-access-key-",
            initAuth: false,
        });
    }, 120_000);

    afterAll(async () => {
        if (harness) await harness.close();
    });

    afterEach(async () => {
        await harness.resetDbTables([
            () => db.accessKey.deleteMany(),
            () => db.machine.deleteMany(),
            () => db.session.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    async function createAccount(publicKey: string) {
        return db.account.create({
            data: { publicKey, encryptionMode: "plain" },
            select: { id: true },
        });
    }

    async function createSession(accountId: string, tag: string) {
        return db.session.create({
            data: { accountId, tag, encryptionMode: "plain", metadata: "{}" },
            select: { id: true },
        });
    }

    async function createMachine(accountId: string, id: string) {
        return db.machine.create({
            data: { id, accountId, metadata: "{}" },
            select: { id: true },
        });
    }

    it("refuses to write a key for a Session owned by another Account", async () => {
        const owner = await createAccount("pk-access-key-owner");
        const stranger = await createAccount("pk-access-key-stranger");
        const session = await createSession(owner.id, "owned-session");
        const machine = await createMachine(stranger.id, "stranger-machine");

        await expect(createSessionMachineAccessKeyInTx(db, {
            accountId: stranger.id,
            machineId: machine.id,
            sessionId: session.id,
            data: "key",
        })).resolves.toEqual({ ok: false, reason: "binding-not-found" });
        await expect(db.accessKey.count()).resolves.toBe(0);
    });

    it("refuses to write a key for a revoked Machine", async () => {
        const owner = await createAccount("pk-access-key-revoked");
        const session = await createSession(owner.id, "revoked-machine-session");
        const machine = await createMachine(owner.id, "revoked-machine");
        await db.machine.update({
            where: { id: machine.id },
            data: { revokedAt: new Date() },
        });

        await expect(readSessionMachineBindingStateInTx(db, {
            accountId: owner.id,
            machineId: machine.id,
            sessionId: session.id,
        })).resolves.toBe("missing");
        await expect(createSessionMachineAccessKeyInTx(db, {
            accountId: owner.id,
            machineId: machine.id,
            sessionId: session.id,
            data: "key",
        })).resolves.toEqual({ ok: false, reason: "binding-not-found" });
        await expect(db.accessKey.count()).resolves.toBe(0);
    });

    it("creates the exact tuple once and reports a repeated create as existing", async () => {
        const owner = await createAccount("pk-access-key-create");
        const session = await createSession(owner.id, "create-session");
        const machine = await createMachine(owner.id, "create-machine");
        const binding = {
            accountId: owner.id,
            machineId: machine.id,
            sessionId: session.id,
        } as const;

        const created = await createSessionMachineAccessKeyInTx(db, { ...binding, data: "first" });
        expect(created).toMatchObject({ ok: true, created: true });
        if (!created.ok) return;
        expect(created.accessKey).toMatchObject({ data: "first", dataVersion: 1 });

        await expect(createSessionMachineAccessKeyInTx(db, { ...binding, data: "second" }))
            .resolves.toEqual({ ok: false, reason: "already-exists" });
        await expect(db.accessKey.findUniqueOrThrow({
            where: { accountId_machineId_sessionId: binding },
            select: { data: true, dataVersion: true },
        })).resolves.toEqual({ data: "first", dataVersion: 1 });
    });

    it("commits with freshly bound resources and rolls back when the caller aborts", async () => {
        const owner = await createAccount("pk-access-key-outer-transaction");
        const binding = {
            accountId: owner.id,
            sessionId: "transaction-session",
            machineId: "transaction-machine",
        };
        const createBoundResources = async (tx: Tx) => {
            await tx.session.create({ data: {
                id: binding.sessionId,
                accountId: owner.id,
                tag: "transaction-session",
                encryptionMode: "plain",
                metadata: "{}",
            } });
            await tx.machine.create({ data: {
                id: binding.machineId,
                accountId: owner.id,
                metadata: "{}",
            } });
            return createSessionMachineAccessKeyInTx(tx, { ...binding, data: "bound-key" });
        };

        const abort = new Error("caller aborted after AccessKey creation");
        await expect(inTx(async (tx) => {
            expect(await createBoundResources(tx)).toMatchObject({ ok: true, created: true });
            throw abort;
        })).rejects.toBe(abort);
        await expect(db.accessKey.count()).resolves.toBe(0);
        await expect(db.session.count()).resolves.toBe(0);
        await expect(db.machine.count()).resolves.toBe(0);

        await expect(inTx(createBoundResources)).resolves.toMatchObject({
            ok: true,
            created: true,
            accessKey: { data: "bound-key", dataVersion: 1 },
        });
        await expect(db.accessKey.findUniqueOrThrow({
            where: { accountId_machineId_sessionId: binding },
            select: { accountId: true, machineId: true, sessionId: true, data: true },
        })).resolves.toEqual({ ...binding, data: "bound-key" });
    });

    it("updates only on the expected version and reports the current row otherwise", async () => {
        const owner = await createAccount("pk-access-key-update");
        const session = await createSession(owner.id, "update-session");
        const machine = await createMachine(owner.id, "update-machine");
        const binding = {
            accountId: owner.id,
            machineId: machine.id,
            sessionId: session.id,
        } as const;
        await createSessionMachineAccessKeyInTx(db, { ...binding, data: "first" });

        await expect(updateSessionMachineAccessKeyDataInTx(db, {
            ...binding,
            data: "second",
            expectedVersion: 1,
        })).resolves.toEqual({ ok: true, version: 2 });

        await expect(updateSessionMachineAccessKeyDataInTx(db, {
            ...binding,
            data: "third",
            expectedVersion: 1,
        })).resolves.toEqual({
            ok: false,
            reason: "version-mismatch",
            currentVersion: 2,
            currentData: "second",
        });
    });

    it("reports a missing key when the bound Machine is no longer available", async () => {
        const owner = await createAccount("pk-access-key-update-revoked");
        const session = await createSession(owner.id, "update-revoked-session");
        const machine = await createMachine(owner.id, "update-revoked-machine");
        const binding = {
            accountId: owner.id,
            machineId: machine.id,
            sessionId: session.id,
        } as const;
        await createSessionMachineAccessKeyInTx(db, { ...binding, data: "first" });
        await db.machine.update({
            where: { id: machine.id },
            data: { revokedAt: new Date() },
        });

        await expect(updateSessionMachineAccessKeyDataInTx(db, {
            ...binding,
            data: "second",
            expectedVersion: 1,
        })).resolves.toEqual({ ok: false, reason: "not-found" });
    });
});
