import {
    ARTIFACT_PLAIN_DATA_KEY_MARKER,
    encodePlainArtifactStoredContent,
} from "@happier-dev/protocol";
import { describe, expect, it } from "vitest";

import { openArtifactStoredContentPair } from "./artifactStoredContent";

describe("openArtifactStoredContentPair", () => {
    it("rejects stored content whose key marker disagrees with the persisted Account mode", () => {
        const opened = openArtifactStoredContentPair({
            accountId: "account-1",
            artifactId: "artifact-1",
            mode: "e2ee",
            dataEncryptionKey: Buffer.from(
                ARTIFACT_PLAIN_DATA_KEY_MARKER,
                "base64",
            ),
            header: Buffer.from(
                encodePlainArtifactStoredContent({ title: "plain" }),
                "base64",
            ),
            body: Buffer.from(
                encodePlainArtifactStoredContent({ body: "plain" }),
                "base64",
            ),
        });

        expect(opened).toBeNull();
    });

    it("rejects encrypted stored content in a persisted plain Account", () => {
        const opened = openArtifactStoredContentPair({
            accountId: "account-1",
            artifactId: "artifact-1",
            mode: "plain",
            dataEncryptionKey: Buffer.from("encrypted-key"),
            header: Buffer.from("encrypted-header"),
            body: Buffer.from("encrypted-body"),
        });

        expect(opened).toBeNull();
    });
});
