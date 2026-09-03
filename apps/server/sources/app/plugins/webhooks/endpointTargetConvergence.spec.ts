import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    readTarget: vi.fn(),
    readContribution: vi.fn(),
    endpointFindFirst: vi.fn(),
    endpointUpdateMany: vi.fn(),
    markAccountChanged: vi.fn(),
}));

vi.mock("./currentTarget", () => ({
    resolveCurrentPluginWebhookTargetTxV1: mocks.readTarget,
}));
vi.mock("./currentContribution", () => ({
    resolveCurrentPluginWebhookContributionTxV1: mocks.readContribution,
}));
vi.mock("./accountChange", () => ({
    markPluginWebhookAccountChangedInTxV1: mocks.markAccountChanged,
}));

import { convergeCurrentPluginWebhookEndpointTargetTxV1 } from "./endpointTargetConvergence";

const endpointId = "wh_ep_AAECAwQFBgcICQoLDA0ODw";
const contribution = { pluginId: "acme.github", localId: "issues" } as const;
const desiredTarget = {
    machineId: "machine-new",
    materializationId: "materialization-new",
    pluginId: "acme.github",
} as const;

const input = {
    webhookEndpointId: endpointId,
    webhookContribution: contribution,
    desiredTargetMaterialization: desiredTarget,
    sourceInstanceId: "source-1",
    setup: { kind: "accountEndpointV1", credential: "serverGenerated" },
    targetIntentEpoch: 4,
} as const;

function tx() {
    return {
        pluginWebhookEndpoint: {
            findFirst: mocks.endpointFindFirst,
            updateMany: mocks.endpointUpdateMany,
        },
    } as never;
}

describe("plugin webhook endpoint target convergence", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readTarget.mockResolvedValue({
            materialization: desiredTarget,
            machineInstallationId: "install-new",
            pluginVersion: "2.0.0",
        });
        mocks.readContribution.mockResolvedValue({
            pluginId: contribution.pluginId,
            localId: contribution.localId,
            handlerActionLocalId: "receive",
            verifierKind: "github_hmac_sha256_v1",
            routingKind: "accountEndpoint",
        });
        mocks.endpointFindFirst.mockResolvedValue({
            id: endpointId,
            revision: 7,
            enabled: true,
            revokedAt: null,
            releasedAt: null,
            targetIntentEpoch: 4,
            targetMachineId: "machine-old",
            targetMachineInstallationId: "install-old",
            targetMaterializationId: "materialization-old",
            targetPluginVersion: "1.0.0",
            route: { enabled: true, revokedAt: null },
        });
        mocks.endpointUpdateMany.mockResolvedValue({ count: 1 });
        mocks.markAccountChanged.mockResolvedValue(undefined);
    });

    it("refuses a different target under an intent epoch that already names another target", async () => {
        await expect(convergeCurrentPluginWebhookEndpointTargetTxV1({
            tx: tx(),
            serverIdentityId: "server-1",
            accountId: "account-1",
            input,
        })).resolves.toEqual({ kind: "unavailable", code: "endpoint_unavailable" });

        expect(mocks.endpointUpdateMany).not.toHaveBeenCalled();
        expect(mocks.markAccountChanged).not.toHaveBeenCalled();
    });
});
