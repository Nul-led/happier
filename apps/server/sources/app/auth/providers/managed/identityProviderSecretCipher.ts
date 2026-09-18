import { decryptString, encryptString } from "@/modules/encrypt";

import type { IdentityProviderSecrets, ManagedIdentityProviderKind } from "./identityProviderDocuments";
import { parseIdentityProviderSecrets } from "./identityProviderDocuments";

function secretPath(id: string, kind: ManagedIdentityProviderKind): string[] {
    return ["storage", "identity_provider_instance", id, kind, "secrets", "v1"];
}

export function encryptIdentityProviderSecrets(input: Readonly<{
    id: string;
    kind: ManagedIdentityProviderKind;
    secrets: IdentityProviderSecrets;
}>): Uint8Array<ArrayBuffer> {
    return encryptString(secretPath(input.id, input.kind), JSON.stringify(input.secrets));
}

export function decryptIdentityProviderSecrets(input: Readonly<{
    id: string;
    kind: ManagedIdentityProviderKind;
    encryptedSecrets: Uint8Array<ArrayBuffer> | null;
}>): ReturnType<typeof parseIdentityProviderSecrets> {
    if (input.encryptedSecrets === null) return parseIdentityProviderSecrets(input.kind, null);
    try {
        const plaintext = decryptString(secretPath(input.id, input.kind), input.encryptedSecrets);
        return parseIdentityProviderSecrets(input.kind, JSON.parse(plaintext));
    } catch {
        return { ok: false, code: "provider_secret_unreadable" };
    }
}
