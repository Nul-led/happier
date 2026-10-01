import { randomUUID } from "node:crypto";

import type { Socket } from "socket.io";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1 } from "@happier-dev/protocol";
import { TEAM_CREDENTIAL_EXTERNAL_PROVIDER_OPERATION_RETIRE_EVENT_V1 } from "@happier-dev/protocol/teams";
import { auth } from "@/app/auth/auth";
import { eventRouter } from "@/app/events/connectionEventRouter";
import { setAccountStatusInTx } from "@/app/home/governance/accountLifecycle";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { createFakeSocket, getSocketHandler } from "../testkit/socketHarness";
import { machineUpdateHandler } from "./machineUpdateHandler";
import { VERIFIED_MACHINE_INSTALLATION_ID_SOCKET_DATA_KEY } from "./machineSocketInstallationProof";

const HANDLER_OPTIONS = {
    operationSocketBatchLimits: {
        ok: true as const,
        limits: { maxItems: 200, maxSerializedBytes: 524_288 },
    },
};

async function createEstablishedMachineFixture(label: string) {
    const account = await db.account.create({
        data: { publicKey: `pk-${label}-${randomUUID()}` },
        select: { id: true },
    });
    const machine = await db.machine.create({
        data: {
            id: `machine-${label}-${randomUUID()}`,
            accountId: account.id,
            metadata: "metadata-0",
            daemonState: "daemon-state-0",
        },
        select: { id: true },
    });
    const token = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user" });

    // The socket is already admitted: the handshake token it presented at
    // connect is the only credential an established socket carries.
    const disconnect = vi.fn();
    const socket = Object.assign(
        createFakeSocket({ data: { clientType: "machine-scoped", machineId: machine.id } }),
        { handshake: { auth: { token } }, disconnect },
    );
    machineUpdateHandler(account.id, socket as unknown as Socket, HANDLER_OPTIONS);

    return { accountId: account.id, machineId: machine.id, socket };
}

type Fixture = Awaited<ReturnType<typeof createEstablishedMachineFixture>>;

async function attestInstallation(fixture: Fixture) {
    const installationId = randomUUID();
    await db.machine.update({ where: { id: fixture.machineId }, data: { installationId } });
    // This harness begins after the socket handshake has verified the installation proof.
    fixture.socket.data![VERIFIED_MACHINE_INSTALLATION_ID_SOCKET_DATA_KEY] = installationId;
}

async function createBrokerOperation(fixture: Fixture) {
    await attestInstallation(fixture);
    const team = await db.team.create({ data: { name: "Retirement boundary" } });
    const membership = await db.teamMembership.create({ data: {
        teamId: team.id, accountId: fixture.accountId, role: "owner",
    } });
    const sourceBindingJson = JSON.stringify({
        v: 1, kind: "provider_connection", connectionId: "connection-1",
        connectionSecurityFingerprint: "connection-security:v1:1", credentialSlotId: "apiKey",
    });
    const resource = await db.teamCredentialResource.create({ data: {
        teamId: team.id, custodianAccountId: fixture.accountId, displayName: "Broker",
        disclosureCeiling: "brokered_only", sessionUsePolicy: "personal_allowed", sourceBindingJson,
    } });
    const operation = {
        v: 1 as const, operationId: randomUUID(), brokerMachineId: fixture.machineId,
        brokerPlacementFingerprint: "a".repeat(64), sourceBindingJson,
    };
    const key = await db.teamCredentialExternalApiKey.create({ data: {
        resourceId: resource.id, teamMembershipId: membership.id, label: "Client",
        displayPrefix: "test", secretDigest: randomUUID(), currentBrokerOperationJson: JSON.stringify(operation),
    } });
    return {
        keyId: key.id, operation,
        request: { v: 1, externalApiKeyId: key.id, operationId: operation.operationId },
        read: async () => (await db.teamCredentialExternalApiKey.findUniqueOrThrow({ where: { id: key.id } })).currentBrokerOperationJson,
    };
}

async function emit(fixture: Fixture, event: string, payload: unknown) {
    const callback = vi.fn();
    await getSocketHandler(fixture.socket, event)(payload, callback);
    return callback;
}

async function suspend(fixture: Fixture) {
    // The eager eviction leg is stubbed to a no-op: this is exactly the state a
    // lost cross-node disconnect publication leaves behind, and the only state
    // this guard exists for.
    const eviction = vi.spyOn(eventRouter, "disconnectAccountSockets").mockImplementation(() => {});
    const applied = await inTx(async (tx) => await setAccountStatusInTx(tx, {
        actorAccountId: fixture.accountId,
        targetAccountId: fixture.accountId,
        status: "suspended",
        authority: "account_erasure",
    }));
    expect(applied).toEqual({ status: "applied" });
    expect(eviction).toHaveBeenCalledWith(fixture.accountId);
}

describe("Machine authority mutations on an established socket", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-machine-update-currentness-",
            // A Machine mutation must not need a second pool connection while its transaction is open.
            sqliteConnectionLimit: 1,
            initAuth: true,
            env: {
                HANDY_MASTER_SECRET: "machine-update-currentness-secret",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
            },
        });
    }, 120_000);

    afterEach(async () => {
        vi.restoreAllMocks();
        harness.resetEnv({
            HANDY_MASTER_SECRET: "machine-update-currentness-secret",
            AUTH_REQUIRED_LOGIN_PROVIDERS: "",
        });
        await db.teamCredentialExternalApiKey.deleteMany();
        await db.team.deleteMany();
        await db.machine.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("retires only the exact authenticated Machine operation and leaves a newer operation intact on stale replay", async () => {
        const subject = await createEstablishedMachineFixture("retire");
        const broker = await createBrokerOperation(subject);
        const retire = () => emit(subject, TEAM_CREDENTIAL_EXTERNAL_PROVIDER_OPERATION_RETIRE_EVENT_V1, broker.request);
        expect(await retire()).toHaveBeenCalledWith({ ok: true, retired: true });
        expect(await broker.read()).toBeNull();
        expect(await retire()).toHaveBeenCalledWith({ ok: true, retired: false });
        const newer = JSON.stringify({ ...broker.operation, operationId: randomUUID() });
        await db.teamCredentialExternalApiKey.update({ where: { id: broker.keyId }, data: { currentBrokerOperationJson: newer } });
        expect(await retire()).toHaveBeenCalledWith({ ok: true, retired: false });
        expect(await broker.read()).toBe(newer);
    });

    it("denies another Account and another Machine in the custodian Account", async () => {
        const subject = await createEstablishedMachineFixture("retire-owner");
        const broker = await createBrokerOperation(subject);
        const foreign = await createEstablishedMachineFixture("retire-foreign");
        await attestInstallation(foreign);
        expect(await emit(foreign, TEAM_CREDENTIAL_EXTERNAL_PROVIDER_OPERATION_RETIRE_EVENT_V1, broker.request))
            .toHaveBeenCalledWith({ ok: false, reasonCode: "resource_forbidden" });
        const otherMachine = await db.machine.create({ data: {
            id: randomUUID(), accountId: subject.accountId, metadata: "{}", installationId: randomUUID(),
        } });
        subject.socket.data!.machineId = otherMachine.id;
        subject.socket.data![VERIFIED_MACHINE_INSTALLATION_ID_SOCKET_DATA_KEY] = otherMachine.installationId;
        expect(await emit(subject, TEAM_CREDENTIAL_EXTERNAL_PROVIDER_OPERATION_RETIRE_EVENT_V1, broker.request))
            .toHaveBeenCalledWith({ ok: false, reasonCode: "resource_forbidden" });
        expect(await broker.read()).toBe(JSON.stringify(broker.operation));
    });

    it("rejects body identity spoofing, unverified installations and replaced installation identity", async () => {
        const subject = await createEstablishedMachineFixture("retire-proof");
        const broker = await createBrokerOperation(subject);
        const event = TEAM_CREDENTIAL_EXTERNAL_PROVIDER_OPERATION_RETIRE_EVENT_V1;
        expect(await emit(subject, event, { ...broker.request, machineId: subject.machineId }))
            .toHaveBeenCalledWith({ ok: false, reasonCode: "invalid_request" });
        subject.socket.data!.clientType = "user-scoped";
        expect(await emit(subject, event, broker.request))
            .toHaveBeenCalledWith({ ok: false, reasonCode: "resource_forbidden" });
        subject.socket.data!.clientType = "machine-scoped";
        const installationId = subject.socket.data![VERIFIED_MACHINE_INSTALLATION_ID_SOCKET_DATA_KEY];
        delete subject.socket.data![VERIFIED_MACHINE_INSTALLATION_ID_SOCKET_DATA_KEY];
        expect(await emit(subject, event, broker.request))
            .toHaveBeenCalledWith({ ok: false, reasonCode: "resource_forbidden" });
        subject.socket.data![VERIFIED_MACHINE_INSTALLATION_ID_SOCKET_DATA_KEY] = installationId;
        await db.machine.update({ where: { id: subject.machineId }, data: { installationId: randomUUID() } });
        expect(await emit(subject, event, broker.request))
            .toHaveBeenCalledWith({ ok: false, reasonCode: "resource_forbidden" });
        expect(await broker.read()).toBe(JSON.stringify(broker.operation));
    });

    it("allows the selected installation to release custody after the Machine becomes ineligible", async () => {
        const subject = await createEstablishedMachineFixture("retire-ineligible");
        const broker = await createBrokerOperation(subject);
        await db.machine.update({ where: { id: subject.machineId }, data: { revokedAt: new Date() } });
        expect(await emit(subject, TEAM_CREDENTIAL_EXTERNAL_PROVIDER_OPERATION_RETIRE_EVENT_V1, broker.request))
            .toHaveBeenCalledWith({ ok: true, retired: true });
        expect(await broker.read()).toBeNull();
    });

    it("preserves custody when an established socket outlives Account credential revocation", async () => {
        const subject = await createEstablishedMachineFixture("retire-revoked");
        const broker = await createBrokerOperation(subject);
        await suspend(subject);
        expect(await emit(subject, TEAM_CREDENTIAL_EXTERNAL_PROVIDER_OPERATION_RETIRE_EVENT_V1, broker.request))
            .toHaveBeenCalledWith({ ok: false, reasonCode: "resource_forbidden" });
        expect(await broker.read()).toBe(JSON.stringify(broker.operation));
    });

    it("refuses a daemon-state write and disconnects when the Account credential is no longer current", async () => {
        const subject = await createEstablishedMachineFixture("state");
        const control = await createEstablishedMachineFixture("state-control");

        const admitted = await emit(subject, "machine-update-state", {
            machineId: subject.machineId,
            daemonState: "daemon-state-1",
            expectedVersion: 0,
        });
        expect(admitted).toHaveBeenCalledWith(expect.objectContaining({ result: "success", version: 1 }));

        await suspend(subject);

        const refused = await emit(subject, "machine-update-state", {
            machineId: subject.machineId,
            daemonState: "daemon-state-2",
            expectedVersion: 1,
        });
        expect(refused).toHaveBeenCalledWith({ result: "error", message: "Forbidden" });
        expect(subject.socket.disconnect).toHaveBeenCalledWith(true);

        const stored = await db.machine.findUnique({
            where: { id: subject.machineId },
            select: { daemonState: true, daemonStateVersion: true },
        });
        expect(stored).toEqual({ daemonState: "daemon-state-1", daemonStateVersion: 1 });

        const unaffected = await emit(control, "machine-update-state", {
            machineId: control.machineId,
            daemonState: "daemon-state-1",
            expectedVersion: 0,
        });
        expect(unaffected).toHaveBeenCalledWith(expect.objectContaining({ result: "success", version: 1 }));
        expect(control.socket.disconnect).not.toHaveBeenCalled();
    });

    it("refuses a metadata write and disconnects when the Account credential is no longer current", async () => {
        const subject = await createEstablishedMachineFixture("metadata");

        const admitted = await emit(subject, "machine-update-metadata", {
            machineId: subject.machineId,
            metadata: "metadata-1",
            expectedVersion: 0,
        });
        expect(admitted).toHaveBeenCalledWith(expect.objectContaining({ result: "success", version: 1 }));

        await suspend(subject);

        const refused = await emit(subject, "machine-update-metadata", {
            machineId: subject.machineId,
            metadata: "metadata-2",
            expectedVersion: 1,
        });
        expect(refused).toHaveBeenCalledWith({ result: "error", message: "Forbidden" });
        expect(subject.socket.disconnect).toHaveBeenCalledWith(true);

        const stored = await db.machine.findUnique({
            where: { id: subject.machineId },
            select: { metadata: true, metadataVersion: true },
        });
        expect(stored).toEqual({ metadata: "metadata-1", metadataVersion: 1 });
    });

    it("refuses an operation-capability projection and disconnects when the Account credential is no longer current", async () => {
        const subject = await createEstablishedMachineFixture("capabilities");

        const admitted = await emit(subject, MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1, {
            machineId: subject.machineId,
            capabilities: { sessionSpawn: { protocolVersions: [1] } },
        });
        expect(admitted).toHaveBeenCalledWith(expect.objectContaining({ v: 1, result: "success", revision: 1 }));

        await suspend(subject);

        const refused = await emit(subject, MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1, {
            machineId: subject.machineId,
            capabilities: { sessionSpawn: { protocolVersions: [1] }, pluginWebhookClaim: { protocolVersions: [1] } },
        });
        expect(refused).toHaveBeenCalledWith({ v: 1, result: "error", code: "machine_unavailable" });
        expect(subject.socket.disconnect).toHaveBeenCalledWith(true);

        const stored = await db.machine.findUnique({
            where: { id: subject.machineId },
            select: { operationProtocolCapabilitiesRevision: true },
        });
        expect(stored?.operationProtocolCapabilitiesRevision).toBe(1);
    });
});
