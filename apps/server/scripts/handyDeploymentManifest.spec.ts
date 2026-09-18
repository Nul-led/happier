import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseAllDocuments } from "yaml";
import { describe, expect, it } from "vitest";

interface KubernetesDocument {
    kind?: string;
    metadata?: { name?: string };
    spec?: {
        replicas?: number;
        strategy?: {
            type?: string;
            rollingUpdate?: unknown;
        };
        template?: {
            spec?: {
                containers?: Array<{
                    env?: Array<{ name?: string; value?: string }>;
                }>;
            };
        };
    };
}

function readHandyDeploymentDocuments(): KubernetesDocument[] {
    const source = readFileSync(join(import.meta.dirname, "../deploy/handy.yaml"), "utf8");
    return parseAllDocuments(source).map((document) => document.toJS() as KubernetesDocument);
}

describe("handy Kubernetes deployment manifest", () => {
    it("replaces the Redis-backed multi-replica API pool as one adapter generation", () => {
        const apiDeployment = readHandyDeploymentDocuments().find(
            (document) => document.kind === "Deployment" && document.metadata?.name === "handy-server",
        );

        expect(apiDeployment).toBeDefined();
        expect(apiDeployment?.spec?.replicas).toBe(2);
        expect(apiDeployment?.spec?.template?.spec?.containers?.[0]?.env).toEqual(
            expect.arrayContaining([
                { name: "SERVER_ROLE", value: "api" },
                { name: "HAPPIER_SOCKET_ADAPTER", value: "redis-streams" },
            ]),
        );
        expect(apiDeployment?.spec?.strategy).toEqual({ type: "Recreate" });
    });
});
