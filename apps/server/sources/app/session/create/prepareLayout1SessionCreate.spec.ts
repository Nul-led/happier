import { describe, expect, it } from "vitest";

import {
    prepareLayout1SessionCreate,
    resolveEffectiveLayout1SessionEncryptionMode,
} from "./prepareLayout1SessionCreate";

const PLAIN_OWNER_METADATA = { t: "plain", v: { v: 1 } } as const;
const ENCRYPTED_OWNER_METADATA = {
    t: "encrypted",
    c: "oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==",
} as const;

function prepare(overrides: Partial<Parameters<typeof prepareLayout1SessionCreate>[0]> = {}) {
    return prepareLayout1SessionCreate({
        accountId: "account-1",
        tag: "tag-1",
        metadata: JSON.stringify({ v: 1 }),
        ownerMetadata: PLAIN_OWNER_METADATA,
        agentState: null,
        dataEncryptionKey: null,
        requestedEncryptionMode: undefined,
        requestedStorageState: undefined,
        organizationPlacement: undefined,
        accountEncryptionMode: "plain",
        storagePolicy: "optional",
        defaultAccountMode: "e2ee",
        ...overrides,
    });
}

describe("prepareLayout1SessionCreate", () => {
    it("resolves the persisted Account mode when the request omits one", () => {
        expect(resolveEffectiveLayout1SessionEncryptionMode({
            storagePolicy: "optional",
            defaultAccountMode: "e2ee",
            requestedEncryptionMode: undefined,
            accountEncryptionMode: "plain",
        })).toBe("plain");
    });

    it("lets the storage policy override both the request and the Account mode", () => {
        expect(resolveEffectiveLayout1SessionEncryptionMode({
            storagePolicy: "required_e2ee",
            defaultAccountMode: "plain",
            requestedEncryptionMode: "plain",
            accountEncryptionMode: "plain",
        })).toBe("e2ee");
        expect(resolveEffectiveLayout1SessionEncryptionMode({
            storagePolicy: "plaintext_only",
            defaultAccountMode: "e2ee",
            requestedEncryptionMode: "e2ee",
            accountEncryptionMode: "e2ee",
        })).toBe("plain");
    });

    it("rejects a requested mode the storage policy forbids with its canonical code", () => {
        const result = prepare({
            storagePolicy: "required_e2ee",
            requestedEncryptionMode: "plain",
        });
        expect(result).toEqual({
            ok: false,
            rejection: {
                reason: "encryption-mode-not-allowed",
                code: "storage_policy_requires_e2ee",
            },
        });
    });

    it("rejects an owner envelope that does not match the persisted Account mode", () => {
        expect(prepare({
            accountEncryptionMode: "plain",
            ownerMetadata: ENCRYPTED_OWNER_METADATA,
        })).toEqual({
            ok: false,
            rejection: { reason: "invalid-params" },
        });
    });

    it("never accepts a fabricated data key for a plain Session", () => {
        expect(prepare({
            accountEncryptionMode: "plain",
            dataEncryptionKey: Buffer.from("fabricated").toString("base64"),
        })).toEqual({
            ok: false,
            rejection: { reason: "invalid-params" },
        });
    });

    it("rejects plain stored content that is not canonical shared metadata", () => {
        expect(prepare({ metadata: "not-json" })).toEqual({
            ok: false,
            rejection: { reason: "invalid-params" },
        });
        expect(prepare({ agentState: "[]" })).toEqual({
            ok: false,
            rejection: { reason: "invalid-params" },
        });
    });

    it("prepares a plain Layout-1 create without a data key", () => {
        const result = prepare();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.prepared).toMatchObject({
            accountId: "account-1",
            tag: "tag-1",
            effectiveEncryptionMode: "plain",
            dataEncryptionKey: null,
        });
    });

    it("prepares an E2EE Layout-1 create with its decoded data key", () => {
        const result = prepare({
            accountEncryptionMode: "e2ee",
            ownerMetadata: ENCRYPTED_OWNER_METADATA,
            metadata: "opaque-ciphertext",
            dataEncryptionKey: Buffer.from([1, 2, 3]).toString("base64"),
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.prepared.effectiveEncryptionMode).toBe("e2ee");
        expect(result.prepared.dataEncryptionKey).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("rejects a fresh E2EE Layout-1 create without its owner Session envelope", () => {
        expect(prepare({
            accountEncryptionMode: "e2ee",
            ownerMetadata: ENCRYPTED_OWNER_METADATA,
            metadata: "opaque-ciphertext",
            dataEncryptionKey: null,
        })).toEqual({
            ok: false,
            rejection: { reason: "invalid-params" },
        });
    });
});
