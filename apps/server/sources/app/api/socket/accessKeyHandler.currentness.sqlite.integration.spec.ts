import { randomUUID } from "node:crypto";

import type { Socket } from "socket.io";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { auth } from "@/app/auth/auth";
import type { ClientConnection } from "@/app/events/eventPayloadTypes";
import { eventRouter } from "@/app/events/connectionEventRouter";
import { setAccountStatusInTx } from "@/app/home/governance/accountLifecycle";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { createFakeSocket, getSocketHandler } from "../testkit/socketHarness";
import { accessKeyHandler } from "./accessKeyHandler";

async function createEstablishedAccountFixture(label: string) {
    const account = await db.account.create({
        data: { publicKey: `pk-${label}-${randomUUID()}` },
        select: { id: true },
    });
    const session = await db.session.create({
        data: { accountId: account.id, tag: `tag-${label}-${randomUUID()}`, metadata: "{}" },
        select: { id: true },
    });
    const machine = await db.machine.create({
        data: { id: `machine-${label}-${randomUUID()}`, accountId: account.id, metadata: "{}" },
        select: { id: true },
    });
    await db.accessKey.create({
        data: { accountId: account.id, machineId: machine.id, sessionId: session.id, data: "encrypted-envelope" },
    });
    const token = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user" });

    // The socket is already admitted: the handshake token it presented at
    // connect is the only credential an established socket carries.
    const disconnect = vi.fn();
    const socket = Object.assign(
        createFakeSocket({ data: { clientType: "user-scoped" } }),
        { handshake: { auth: { token } }, disconnect },
    );
    const connection: ClientConnection = {
        connectionType: "user-scoped",
        socket: socket as unknown as Socket,
        userId: account.id,
    };
    accessKeyHandler(account.id, socket as unknown as Socket, connection);

    return { accountId: account.id, sessionId: session.id, machineId: machine.id, socket };
}

async function readAccessKey(fixture: Awaited<ReturnType<typeof createEstablishedAccountFixture>>) {
    const callback = vi.fn();
    await getSocketHandler(fixture.socket, "access-key-get")(
        { sessionId: fixture.sessionId, machineId: fixture.machineId },
        callback,
    );
    return callback;
}

describe("access-key-get currentness on an established socket", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-access-key-currentness-",
            initAuth: true,
            env: {
                HANDY_MASTER_SECRET: "access-key-currentness-secret",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
            },
        });
    }, 120_000);

    afterEach(async () => {
        vi.restoreAllMocks();
        harness.resetEnv({
            HANDY_MASTER_SECRET: "access-key-currentness-secret",
            AUTH_REQUIRED_LOGIN_PROVIDERS: "",
        });
        await db.accessKey.deleteMany();
        await db.session.deleteMany();
        await db.machine.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("refuses and disconnects a surviving socket whose Account credential is no longer current", async () => {
        const subject = await createEstablishedAccountFixture("subject");
        const control = await createEstablishedAccountFixture("control");

        const admitted = await readAccessKey(subject);
        expect(admitted).toHaveBeenCalledWith(
            expect.objectContaining({ ok: true, accessKey: expect.objectContaining({ data: "encrypted-envelope" }) }),
        );

        // Commit the status change with the eager eviction leg stubbed to a
        // no-op: this is exactly the state a lost cross-node disconnect
        // publication leaves behind, and the only state this guard exists for.
        const eviction = vi.spyOn(eventRouter, "disconnectAccountSockets").mockImplementation(() => {});
        const applied = await inTx(async (tx) => await setAccountStatusInTx(tx, {
            actorAccountId: subject.accountId,
            targetAccountId: subject.accountId,
            status: "suspended",
            authority: "account_erasure",
        }));
        expect(applied).toEqual({ status: "applied" });
        expect(eviction).toHaveBeenCalledWith(subject.accountId);
        expect(subject.socket.disconnect).not.toHaveBeenCalled();

        const refused = await readAccessKey(subject);
        expect(refused).toHaveBeenCalledWith({ ok: false, error: "Forbidden" });
        expect(subject.socket.disconnect).toHaveBeenCalledWith(true);

        const unaffected = await readAccessKey(control);
        expect(unaffected).toHaveBeenCalledWith(
            expect.objectContaining({ ok: true, accessKey: expect.objectContaining({ data: "encrypted-envelope" }) }),
        );
        expect(control.socket.disconnect).not.toHaveBeenCalled();
    });
});
