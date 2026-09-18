import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    encodePlainMachineStoredContent,
    MACHINE_PLAIN_DATA_KEY_MARKER,
} from "@happier-dev/protocol";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import {
    createLightSqliteHarness,
    type LightSqliteHarness,
} from "@/testkit/lightSqliteHarness";

import { migrateMachineAccountEncryptionInTx } from "./migrateMachineAccountEncryptionInTx";

const TARGETS = [
    {
        name: "plain",
        sourceAccountMode: "e2ee",
        toMode: "plain",
        metadata: encodePlainMachineStoredContent({ host: "target-plain" }),
        daemonState: encodePlainMachineStoredContent({ status: "running" }),
        dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
        contentPublicKeyFingerprint: null,
    },
    {
        name: "e2ee legacy",
        sourceAccountMode: "plain",
        toMode: "e2ee",
        metadata: "target-e2ee-metadata-ciphertext",
        daemonState: "target-e2ee-daemon-ciphertext",
        dataEncryptionKey: null,
        contentPublicKeyFingerprint: null,
    },
    {
        name: "e2ee rekey",
        sourceAccountMode: "plain",
        toMode: "e2ee",
        metadata: "target-rekeyed-metadata-ciphertext",
        daemonState: "target-rekeyed-daemon-ciphertext",
        dataEncryptionKey: Buffer.from([41, 42, 43]).toString("base64"),
        contentPublicKeyFingerprint: "target-content-key-fingerprint",
    },
] as const;

describe("migrateMachineAccountEncryptionInTx (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-machine-account-encryption-migrate-",
            initAuth: false,
        });
    }, 120_000);

    afterAll(async () => {
        if (harness) await harness.close();
    });

    afterEach(async () => {
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.accessKey.deleteMany(),
            () => db.session.deleteMany(),
            () => db.machine.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it.each(
        TARGETS.flatMap((target) => [false, true].map((revoked) => ({
            ...target,
            revoked,
            state: revoked ? "revoked" : "active",
        }))),
    )(
        "rejects a complete $name directive containing an $state Runner before any durable change",
        async (target) => {
            const account = await db.account.create({
                data: {
                    encryptionMode: target.sourceAccountMode,
                    settings: "account-settings-before",
                    settingsVersion: 7,
                    seq: 11,
                },
            });
            const runner = await db.machine.create({
                data: {
                    id: `runner-${target.name.replace(/ /g, "-")}-${target.revoked ? "revoked" : "active"}`,
                    kind: "ephemeral_session_runner",
                    accountId: account.id,
                    metadata: "runner-metadata-before",
                    metadataVersion: 2,
                    daemonState: "runner-daemon-before",
                    daemonStateVersion: 3,
                    dataEncryptionKey: new Uint8Array([1, 2, 3]),
                    runnerContentKeyBinding: {
                        v: 1,
                        purpose: "runner-binding-before",
                    },
                    contentPublicKeyFingerprint:
                        "runner-content-key-fingerprint-before",
                    active: !target.revoked,
                    revokedAt: target.revoked
                        ? new Date("2026-09-13T10:00:00.000Z")
                        : null,
                },
            });
            const session = await db.session.create({
                data: {
                    accountId: account.id,
                    tag: `session-${runner.id}`,
                    encryptionMode: target.sourceAccountMode,
                    metadata: "session-metadata-before",
                    metadataVersion: 5,
                },
            });
            const accessKey = await db.accessKey.create({
                data: {
                    accountId: account.id,
                    machineId: runner.id,
                    sessionId: session.id,
                    data: "access-key-before",
                },
            });

            const accountBefore = await db.account.findUniqueOrThrow({
                where: { id: account.id },
            });
            const machineBefore = await db.machine.findUniqueOrThrow({
                where: { id: runner.id },
            });
            const sessionBefore = await db.session.findUniqueOrThrow({
                where: { id: session.id },
            });
            const accessKeyBefore = await db.accessKey.findUniqueOrThrow({
                where: { id: accessKey.id },
            });
            const markChanged = vi.fn(async () => undefined);

            const result = await inTx(async (tx) =>
                await migrateMachineAccountEncryptionInTx({
                    tx,
                    accountId: account.id,
                    toMode: target.toMode,
                    directive: {
                        action: "migrate",
                        items: [{
                            machineId: runner.id,
                            expectedMetadataVersion:
                                runner.metadataVersion,
                            expectedDaemonStateVersion:
                                runner.daemonStateVersion,
                            metadata: target.metadata,
                            daemonState: target.daemonState,
                            dataEncryptionKey: target.dataEncryptionKey,
                            contentPublicKeyFingerprint:
                                target.contentPublicKeyFingerprint,
                        }],
                    },
                    markChanged,
                }),
            );

            expect(result).toEqual({
                status: "unsupported_machine_kind",
            });
            expect(markChanged).not.toHaveBeenCalled();
            await expect(db.account.findUniqueOrThrow({
                where: { id: account.id },
            })).resolves.toEqual(accountBefore);
            await expect(db.machine.findUniqueOrThrow({
                where: { id: runner.id },
            })).resolves.toEqual(machineBefore);
            await expect(db.session.findUniqueOrThrow({
                where: { id: session.id },
            })).resolves.toEqual(sessionBefore);
            await expect(db.accessKey.findUniqueOrThrow({
                where: { id: accessKey.id },
            })).resolves.toEqual(accessKeyBefore);
            await expect(db.accountChange.count({
                where: { accountId: account.id },
            })).resolves.toBe(0);
        },
    );
});
