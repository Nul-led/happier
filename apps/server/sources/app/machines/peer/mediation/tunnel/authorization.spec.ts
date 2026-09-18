import { describe, expect, it } from "vitest";
import tweetnacl from "tweetnacl";

import { verifyPeerTcpTunnelRelayAuthorizationV2 } from "@happier-dev/protocol";
import { TeamCredentialSourceBindingV1Schema } from "@happier-dev/protocol/teams";
import { mintProviderBrokerRelayAuthorizationV2 } from "./authorization";

describe("mintProviderBrokerRelayAuthorizationV2", () => {
    it("signs a resource-test consequence with value-free credential evidence and exact current source", () => {
        const signing = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(12));
        const binding = {
            v: 1 as const,
            kind: "resource_test" as const,
            teamId: "team-1",
            resourceId: "resource-1",
            requestId: "request-1",
            actorAccountId: "actor-1",
            expectedResourceRevision: 7,
            application: {
                agentTargetKey: "codex",
                implementationIdentity: { pluginId: "happier.provider.openai", localId: "openai" },
                endpointTemplateId: "responses",
                protocol: "openai-responses" as const,
            },
            source: TeamCredentialSourceBindingV1Schema.parse({
                v: 1,
                kind: "provider_connection",
                connectionId: "connection-1",
                connectionSecurityFingerprint: "connection-security:v1:1",
                credentialSlotId: "apiKey",
            }),
            verifiedCredentialEvidence: {
                v: 1 as const,
                evidence: [{ kind: "home_method" as const, methodId: "email_password" }],
            },
        };
        const result = mintProviderBrokerRelayAuthorizationV2({
            accountId: "custodian-account",
            targetMachineId: "broker-machine",
            relaySocketId: "home-relay-socket",
            binding,
            tunnelId: "resource-test-request-1",
            nowMs: 1_000,
            ttlMs: 30_000,
            serverGateEnabled: true,
            serverCaps: { maxBytes: 1024, maxFrameBytes: 1024, maxIdleMs: 10_000, maxDurationMs: 30_000 },
            signingKey: { keyId: "test-key", secretKey: signing.secretKey },
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.relayAuthorization.payload).toMatchObject({
            targetMachineId: "broker-machine",
            providerBroker: binding,
        });
        const trustRoots = [{ keyId: "test-key", publicKeyBase64Url: Buffer.from(signing.publicKey).toString("base64url") }];
        expect(verifyPeerTcpTunnelRelayAuthorizationV2({
            authorization: result.relayAuthorization,
            nowMs: 2_000,
            trustRoots,
        })).toMatchObject({ valid: true });
        const { verifiedCredentialEvidence: _verifiedCredentialEvidence, ...bindingWithoutEvidence } = binding;
        for (const providerBroker of [
            { ...binding, teamId: "other-team" },
            { ...binding, resourceId: "other-resource" },
            { ...binding, expectedResourceRevision: 8 },
            { ...binding, application: { ...binding.application, endpointTemplateId: "chat-completions" } },
            { ...binding, source: { ...binding.source, credentialSlotId: "other-slot" } },
            bindingWithoutEvidence,
        ]) {
            expect(verifyPeerTcpTunnelRelayAuthorizationV2({
                authorization: {
                    ...result.relayAuthorization,
                    payload: { ...result.relayAuthorization.payload, providerBroker },
                },
                nowMs: 2_000,
                trustRoots,
            })).toMatchObject({ valid: false, reasonCode: "bad_signature" });
        }
        expect(verifyPeerTcpTunnelRelayAuthorizationV2({
            authorization: {
                ...result.relayAuthorization,
                payload: { ...result.relayAuthorization.payload, targetMachineId: "other-broker-machine" },
            },
            nowMs: 2_000,
            trustRoots,
        })).toMatchObject({ valid: false, reasonCode: "bad_signature" });
    });

    it("mints a destination-free grant bound to one external broker application", () => {
        const signing = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
        const result = mintProviderBrokerRelayAuthorizationV2({
            accountId: "custodian-account",
            targetMachineId: "broker-machine",
            relaySocketId: "home-relay-socket",
            binding: {
                v: 1,
                kind: "external_api_key",
                teamId: "team-1",
                resourceId: "resource-1",
                requestId: "request-1",
                externalApiKeyId: "550e8400-e29b-41d4-a716-446655440000",
                assignedAccountId: "assigned-account",
                assignedTeamMembershipId: "membership-1",
            },
            tunnelId: "external-provider-request-1",
            nowMs: 1_000,
            ttlMs: 30_000,
            serverGateEnabled: true,
            serverCaps: {
                maxBytes: 1024 * 1024,
                maxFrameBytes: 64 * 1024,
                maxIdleMs: 10_000,
                maxDurationMs: 30_000,
            },
            signingKey: { keyId: "test-key", secretKey: signing.secretKey },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.relayAuthorization.payload).toMatchObject({
            flowKind: "provider_broker",
            accountId: "custodian-account",
            targetMachineId: "broker-machine",
            providerBroker: { requestId: "request-1", assignedAccountId: "assigned-account" },
        });
        expect(result.relayAuthorization.payload).not.toHaveProperty("destination");
        expect(verifyPeerTcpTunnelRelayAuthorizationV2({
            authorization: result.relayAuthorization,
            nowMs: 2_000,
            trustRoots: [{ keyId: "test-key", publicKeyBase64Url: Buffer.from(signing.publicKey).toString("base64url") }],
        })).toMatchObject({ valid: true });
    });

    it("fails closed when public Provider ingress is disabled", () => {
        const signing = tweetnacl.sign.keyPair();
        expect(mintProviderBrokerRelayAuthorizationV2({
            accountId: "custodian-account",
            targetMachineId: "broker-machine",
            relaySocketId: "home-relay-socket",
            binding: {
                v: 1, kind: "external_api_key", teamId: "team-1", resourceId: "resource-1", requestId: "request-1",
                externalApiKeyId: "550e8400-e29b-41d4-a716-446655440000",
                assignedAccountId: "assigned-account", assignedTeamMembershipId: "membership-1",
            },
            tunnelId: "external-provider-request-1",
            nowMs: 1_000,
            ttlMs: 30_000,
            serverGateEnabled: false,
            serverCaps: { maxBytes: 1, maxFrameBytes: 1, maxIdleMs: 1, maxDurationMs: 1 },
            signingKey: { keyId: "test-key", secretKey: signing.secretKey },
        })).toMatchObject({ ok: false, reasonCode: "blocked_by_server_policy" });
    });
});
