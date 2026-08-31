import { authApproveAtEndpoint } from '@/auth/flows/approve';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import type { SystemTaskEvent } from '@happier-dev/protocol';

/**
 * Explicit-target approval configuration for system-task token-only pairing prompts. The target
 * endpoint and identity are supplied by the caller; the focused Home is never consulted.
 */
export type SystemTaskAuthRequestApproval = Readonly<{
    /** Explicit target Home endpoint; never resolved from the focused Home. */
    expectedRelayUrl: string;
    serverId?: string;
}>;

export type SystemTaskTokenOnlyAuthRequestPrompt = Readonly<{
    publicKey: string;
    response: string;
    relayUrl: string;
}>;

/**
 * Recognizes the blocking token-only approval prompt emitted by `setup.thisComputer.v1`.
 * Legacy non-blocking `authRequest` prompts (no response material) are ignored.
 */
export function readTokenOnlyAuthRequestPrompt(event: SystemTaskEvent): SystemTaskTokenOnlyAuthRequestPrompt | null {
    if (event.type !== 'prompt') {
        return null;
    }
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null;
    }
    const record = data as Record<string, unknown>;
    if (record.kind !== 'authRequest' || record.responseKind !== 'tokenOnly') {
        return null;
    }
    const publicKey = typeof record.publicKey === 'string' ? record.publicKey.trim() : '';
    const response = typeof record.response === 'string' ? record.response : '';
    const relayUrl = typeof record.relayUrl === 'string' ? record.relayUrl.trim() : '';
    if (!publicKey || !response || !relayUrl) {
        return null;
    }
    return { publicKey, response, relayUrl };
}

function matchesExpectedRelayUrl(promptRelayUrl: string, expectedRelayUrl: string): boolean {
    const promptKey = createServerUrlComparableKey(promptRelayUrl);
    const expectedKey = createServerUrlComparableKey(expectedRelayUrl);
    if (promptKey && expectedKey) {
        return promptKey === expectedKey;
    }
    return promptRelayUrl.trim() === expectedRelayUrl.trim();
}

/**
 * Answers one token-only system-task approval prompt through the explicit endpoint. Validates the
 * prompt's target identity against the expected Home, reads only the Home-scoped credential for
 * that explicit target, posts the opaque response via `authApproveAtEndpoint`, and answers the
 * task with `{ approved: boolean }`. No bearer, pairing secret, claim material, or state path is
 * ever placed in the answer; any mismatch or failure declines so the task falls back to the
 * legacy manual approval surface.
 */
export async function respondToTokenOnlyAuthRequestPrompt(params: Readonly<{
    prompt: SystemTaskTokenOnlyAuthRequestPrompt;
    approval: SystemTaskAuthRequestApproval;
    respond: (answer: Readonly<{ approved: boolean }>) => void | Promise<void>;
}>): Promise<void> {
    const decline = async () => {
        await params.respond({ approved: false });
    };

    if (!matchesExpectedRelayUrl(params.prompt.relayUrl, params.approval.expectedRelayUrl)) {
        await decline();
        return;
    }

    let token: string | null = null;
    try {
        const credentials = await TokenStorage.getCredentialsForServerUrl(
            params.approval.expectedRelayUrl,
            params.approval.serverId ? { serverId: params.approval.serverId } : {},
        );
        token = typeof credentials?.token === 'string' && credentials.token.trim()
            ? credentials.token
            : null;
    } catch {
        token = null;
    }
    if (!token) {
        await decline();
        return;
    }

    try {
        const result = await authApproveAtEndpoint({
            endpointUrl: params.approval.expectedRelayUrl,
            ...(params.approval.serverId ? { serverId: params.approval.serverId } : {}),
            token,
            publicKeyBase64: params.prompt.publicKey,
            responseBase64: params.prompt.response,
            responseKind: 'tokenOnly',
        });
        // `already_authorized` still releases the waiting terminal; only an expired/unknown
        // request declines back to the legacy surface.
        await params.respond({ approved: result !== 'not_found' });
    } catch {
        await decline();
    }
}
