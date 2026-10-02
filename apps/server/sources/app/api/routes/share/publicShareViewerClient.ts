/// <reference lib="dom" />

import {
    decodeBase64, decodePlainArtifactStoredContent, isPlainArtifactStoredContent,
    openPublicShareDataKeyV1, openSessionDataKeyBundleV0,
    readStoredContentPublicShareSecretV1, StoredContentPublicShareReadResponseV1Schema,
} from "@happier-dev/protocol/sharing/public-viewer";

export type PublicShareViewerResult =
    | { status: "ready"; title: string; text: string; nextBeforeSeq: number | null; messagesAccessToken: string | null }
    | { status: "invalid_link" | "unavailable" | "invalid_content" | "consent_required" | "network_error" };

interface ViewerInput {
    location: Pick<Location, "pathname" | "hash" | "origin">;
    fetch: typeof fetch;
    consent?: boolean;
    beforeSeq?: number;
    messagesAccessToken?: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// This is presentation only. Structured transcript records remain readable without
// interpreting their tool payloads, links, HTML, or executable content.
function contentText(value: unknown): string {
    if (typeof value === "string") return value;
    const entry = record(value);
    if (typeof entry?.text === "string") return entry.text;
    const content = record(entry?.content);
    if (typeof content?.text === "string") return content.text;
    return JSON.stringify(value, null, 2) ?? "";
}

export async function loadPublicShareViewerContent(input: ViewerInput): Promise<PublicShareViewerResult> {
    const secret = readStoredContentPublicShareSecretV1(input.location.hash);
    const match = /^\/s\/([^/]+)\/?$/.exec(input.location.pathname);
    if (!secret || !match) return { status: "invalid_link" };
    let lookupId: string;
    try { lookupId = decodeURIComponent(match[1]); } catch { return { status: "invalid_link" }; }
    const url = new URL(`/v1/public-shares/${encodeURIComponent(lookupId)}/content`, input.location.origin);
    if (input.consent) url.searchParams.set("consent", "true");
    if (input.beforeSeq !== undefined) url.searchParams.set("beforeSeq", String(input.beforeSeq));
    let response: Response;
    try {
        response = await input.fetch(url.toString(), {
            credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store",
            ...(input.messagesAccessToken ? { headers: { "x-public-share-messages-access-token": input.messagesAccessToken } } : {}),
        });
    } catch { return { status: "network_error" }; }
    let raw: unknown;
    try { raw = await response.json(); } catch { return { status: response.ok ? "invalid_content" : "unavailable" }; }
    if (!response.ok) {
        if (response.status === 403 && record(raw)?.requiresConsent === true) return { status: "consent_required" };
        return { status: "unavailable" };
    }
    const parsed = StoredContentPublicShareReadResponseV1Schema.safeParse(raw);
    if (!parsed.success || parsed.data.keyDerivation !== "fragment_v1") return { status: "invalid_content" };
    const share = parsed.data;
    const key = share.encryptionMode === "e2ee" && share.encryptedDataKey
        ? openPublicShareDataKeyV1({ encryptedDataKey: share.encryptedDataKey, secret }) : null;
    if (share.encryptionMode === "e2ee" && !key) return { status: "invalid_link" };
    const open = async (encoded: string): Promise<unknown> => {
        if (share.encryptionMode === "plain") {
            if (!isPlainArtifactStoredContent(encoded)) throw new Error("Content mode mismatch");
            return decodePlainArtifactStoredContent(encoded);
        }
        const opened = await openSessionDataKeyBundleV0(decodeBase64(encoded), key!);
        if (opened.status !== "authenticated") throw new Error("Content authentication failed");
        return opened.value;
    };
    try {
        if (share.content.kind === "artifact") {
            const header = record(await open(share.content.header));
            const body = record(await open(share.content.body));
            if (!header || !body || (body.body !== null && typeof body.body !== "string")) return { status: "invalid_content" };
            return { status: "ready", title: typeof header.title === "string" ? header.title : "Shared Artifact",
                text: body.body ?? "", nextBeforeSeq: null, messagesAccessToken: null };
        }
        const messages = await Promise.all(share.content.messages.map(async message => {
            if (share.encryptionMode === "plain") {
                if (message.content.t !== "plain") throw new Error("Content mode mismatch");
                return { seq: message.seq, text: contentText(message.content.v) };
            }
            if (message.content.t !== "encrypted") throw new Error("Content mode mismatch");
            return { seq: message.seq, text: contentText(await open(message.content.c)) };
        }));
        return { status: "ready", title: "Shared Session", text: messages.sort((a, b) => a.seq - b.seq).map(message => message.text).join("\n\n"),
            nextBeforeSeq: share.content.hasMore ? share.content.nextBeforeSeq : null,
            messagesAccessToken: share.messagesAccessToken ?? null };
    } catch { return { status: "invalid_content" }; }
}

export function renderPublicShareViewer(root: HTMLElement, result: PublicShareViewerResult, action?: () => void): void {
    const document = root.ownerDocument;
    const title = document.createElement("h1");
    const content = document.createElement(result.status === "ready" ? "pre" : "p");
    if (result.status === "ready") {
        title.textContent = result.title;
        content.textContent = result.text || "This shared content is empty.";
    } else {
        title.textContent = "Shared content";
        const copy = {
            invalid_link: "This link is incomplete or its key is incorrect. Ask the owner for the full link.",
            unavailable: "This link has expired, reached its viewing limit, or been revoked.",
            invalid_content: "This content could not be opened. Ask the owner for a new link.",
            consent_required: "Opening this link records a visit with the owner. Continue to view the shared content.",
            network_error: "The shared content could not be reached. Try again.",
        };
        content.textContent = copy[result.status];
    }
    root.replaceChildren(title, content);
    if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = result.status === "consent_required" ? "Continue" : result.status === "ready" ? "Load earlier messages" : "Try again";
        button.addEventListener("click", action, { once: true });
        root.append(button);
    }
}
