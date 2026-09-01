import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    createFakeRouteApp,
    createReplyStub,
    getRouteHandler,
} from "../../testkit/routeHarness";
import { evaluateAccountStoredContentCompatibility } from "@/app/clientCompatibility/accountStoredContentCompatibility";

const state = vi.hoisted(() => ({
    tx: undefined as any,
}));

vi.mock("@/storage/inTx", () => ({
    inTx: async (callback: (tx: any) => Promise<unknown>) =>
        await callback(state.tx),
    afterTx: vi.fn(),
}));

import { registerAccountSettingsHistoryRoutes } from "./registerAccountSettingsHistoryRoutes";
import { registerAccountSettingsRoutes } from "./registerAccountSettingsRoutes";

function createTx() {
    const account = {
        seq: 7,
        encryptionMode: "plain" as const,
        publicKey: null,
        contentPublicKey: null,
        contentPublicKeySig: null,
        settings: null,
        settingsVersion: 1,
    };
    return {
        $executeRawUnsafe: vi.fn(async () => 1),
        $queryRawUnsafe: vi.fn(async () => [{ id: "account-1" }]),
        account: {
            findUnique: vi.fn(async (_input: Readonly<{
                select?: Readonly<{ settings?: boolean }>;
            }>) => account),
            updateMany: vi.fn(async () => ({ count: 0 })),
        },
        accountSettingsSnapshot: {
            findUnique: vi.fn(async () => ({
                accountId: "account-1",
                version: 3,
                settingsDbValue: null,
                encryptionMode: "plain" as const,
            })),
        },
    };
}

function admissionCallOrder(tx: ReturnType<typeof createTx>): number {
    const calls = [
        ...tx.$executeRawUnsafe.mock.invocationCallOrder,
        ...tx.$queryRawUnsafe.mock.invocationCallOrder,
    ];
    expect(calls).toHaveLength(1);
    return calls[0]!;
}

function settingsPayloadReadOrder(tx: ReturnType<typeof createTx>): number {
    const index = tx.account.findUnique.mock.calls.findIndex(
        ([input]) => input?.select?.settings === true,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    return tx.account.findUnique.mock.invocationCallOrder[index]!;
}

function storedContentCompatibility(protocolVersion: number | null) {
    return evaluateAccountStoredContentCompatibility(
        protocolVersion === null
            ? { status: "missing" }
            : {
                status: "valid",
                declaration: { v: 1, protocolVersion },
            },
    );
}

describe("Account Settings writer admission", () => {
    beforeEach(() => {
        state.tx = createTx();
    });

    it("admits the legacy Settings writer before it reads the current Settings payload", async () => {
        const app = createFakeRouteApp();
        registerAccountSettingsRoutes(app as any);
        const write = getRouteHandler(app, "POST", "/v1/account/settings");
        const reply = createReplyStub();

        await write({
            userId: "account-1",
            // Both Settings writers run behind `requirePresentUser`. Without the
            // authority an ordinary Account token carries, the preHandler answers
            // 403 and the fence-ordering assertions below never reach the handler.
            authAuthority: "present_user",
            authTokenKind: "account",
            accountStoredContentCompatibility: storedContentCompatibility(4),
            body: { settings: "ciphertext", expectedVersion: 0 },
        }, reply);

        expect(reply.statusCode).toBe(400);
        expect(admissionCallOrder(state.tx)).toBeLessThan(
            settingsPayloadReadOrder(state.tx),
        );
    });

    it("admits the envelope Settings writer before it reads the current Settings payload", async () => {
        const app = createFakeRouteApp();
        registerAccountSettingsRoutes(app as any);
        const write = getRouteHandler(app, "POST", "/v2/account/settings");
        const reply = createReplyStub();

        await write({
            userId: "account-1",
            authAuthority: "present_user",
            authTokenKind: "account",
            accountStoredContentCompatibility: storedContentCompatibility(4),
            body: { content: null, expectedVersion: 0 },
        }, reply);

        expect(reply.statusCode).toBe(200);
        expect(admissionCallOrder(state.tx)).toBeLessThan(
            settingsPayloadReadOrder(state.tx),
        );
    });

    it.each([
        {
            label: "the released 0.2 writer without a declaration",
            protocolVersion: null,
        },
        {
            label: "a V3 writer without profile-preserving semantics",
            protocolVersion: 3,
        },
    ])("rejects $label before either Settings write route opens a transaction", async ({ protocolVersion }) => {
        for (const route of [
            {
                path: "/v1/account/settings",
                body: { settings: "ciphertext", expectedVersion: 0 },
            },
            {
                path: "/v2/account/settings",
                body: { content: null, expectedVersion: 0 },
            },
        ]) {
            state.tx = createTx();
            const app = createFakeRouteApp();
            registerAccountSettingsRoutes(app as any);
            const write = getRouteHandler(app, "POST", route.path);
            const reply = createReplyStub();

            await write({
                userId: "account-1",
                authAuthority: "present_user",
                authTokenKind: "account",
                accountStoredContentCompatibility:
                    storedContentCompatibility(protocolVersion),
                body: route.body,
            }, reply);

            expect(reply.statusCode, route.path).toBe(426);
            expect(reply.send, route.path).toHaveBeenCalledWith({
                error: "client-upgrade-required",
                requirement: {
                    v: 1,
                    kind: "account-stored-content",
                    minimumProtocolVersion: 4,
                },
            });
            expect(state.tx.$executeRawUnsafe, route.path).not.toHaveBeenCalled();
            expect(state.tx.$queryRawUnsafe, route.path).not.toHaveBeenCalled();
            expect(state.tx.account.findUnique, route.path).not.toHaveBeenCalled();
            expect(state.tx.account.updateMany, route.path).not.toHaveBeenCalled();
        }
    });

    it("rejects the retired Settings-history restore before it opens the selected snapshot", async () => {
        const app = createFakeRouteApp();
        registerAccountSettingsHistoryRoutes(app as any);
        const restore = getRouteHandler(
            app,
            "POST",
            "/v2/account/settings/history/:version/restore",
        );
        const reply = createReplyStub();

        await restore({
            userId: "account-1",
            params: { version: 3 },
            body: { content: null, expectedVersion: 0 },
        }, reply);

        expect(reply.statusCode).toBe(426);
        expect(state.tx.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(state.tx.$queryRawUnsafe).not.toHaveBeenCalled();
        expect(state.tx.accountSettingsSnapshot.findUnique).not.toHaveBeenCalled();
    });
});
