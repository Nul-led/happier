import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { encodePlainArtifactStoredContent, sealPublicShareDataKeyV1, sealSessionDataKeyBundleV0 } from "@happier-dev/protocol";
import { encodeBase64 } from "@happier-dev/protocol/sharing/public-viewer";
import { loadPublicShareViewerContent, renderPublicShareViewer } from "./publicShareViewerClient";
import { PUBLIC_SHARE_VIEWER_SCRIPT } from "./publicShareViewerBundle.generated";

const secret = "A".repeat(43);
const location = { origin: "https://share.preview.example.test", pathname: "/s/lookup", hash: `#k=${secret}` };
const plain = {
    subject: { kind: "artifact", id: "artifact" }, encryptionMode: "plain", encryptedDataKey: null,
    keyDerivation: "fragment_v1", isConsentRequired: false,
    content: { kind: "artifact", header: encodePlainArtifactStoredContent({ title: "Shared document" }),
        body: encodePlainArtifactStoredContent({ body: "<script>globalThis.pwned=true</script>" }), headerVersion: 1, bodyVersion: 1 },
};

interface ElementBoundary { tag: string; textContent: string | null; click?: () => void; addEventListener(type: string, callback: () => void): void }
interface RootBoundary { ownerDocument: DocumentBoundary; replaceChildren(...children: ElementBoundary[]): void; append(element: ElementBoundary): void; textContent: string }
interface DocumentBoundary { getElementById(): RootBoundary; createElement(tag: string): ElementBoundary }
function createBrowserBoundary() {
    const elements: ElementBoundary[] = [];
    const document: DocumentBoundary = { getElementById: () => root, createElement: (tag: string): ElementBoundary => ({ tag, textContent: null,
        addEventListener(_type, callback) { this.click = callback; },
    }) };
    const root: RootBoundary = { ownerDocument: document, replaceChildren: (...children: ElementBoundary[]) => { elements.splice(0, elements.length, ...children); },
        append: (element: ElementBoundary) => elements.push(element),
        set textContent(value: string) { elements.splice(0, elements.length, { tag: "#text", textContent: value, addEventListener() {} }); } };
    return { elements, document, root };
}

describe("isolated public viewer browser boundary", () => {
    it("fetches by lookup alone without credentials and opens the canonical plain Artifact codec", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(plain)));
        const result = await loadPublicShareViewerContent({ location, fetch });
        expect(result).toMatchObject({ status: "ready", title: "Shared document", text: "<script>globalThis.pwned=true</script>" });
        expect(fetch).toHaveBeenCalledWith(`${location.origin}/v1/public-shares/lookup/content`, expect.objectContaining({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" }));
        expect(JSON.stringify(fetch.mock.calls)).not.toContain(secret);
        expect(JSON.stringify(fetch.mock.calls)).not.toContain("Authorization");
    });

    it.each(["", "#k=wrong", "#k=" + secret + "&k=" + secret, "#secret=" + secret])("fails closed before fetching for fragment %s", async hash => {
        const fetch = vi.fn<typeof globalThis.fetch>();
        expect(await loadPublicShareViewerContent({ location: { ...location, hash }, fetch })).toMatchObject({ status: "invalid_link" });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("reports consent without implicitly admitting the viewer and retries only the owner consent query", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: "consent_required", requiresConsent: true }), { status: 403 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(plain)));
        expect(await loadPublicShareViewerContent({ location, fetch })).toMatchObject({ status: "consent_required" });
        expect(await loadPublicShareViewerContent({ location, fetch, consent: true })).toMatchObject({ status: "ready" });
        expect(fetch.mock.calls[1]?.[0]).toBe(`${location.origin}/v1/public-shares/lookup/content?consent=true`);
    });

    it("refuses revoked responses and mode/content mismatches", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(new Response("{}", { status: 404 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ...plain, encryptionMode: "e2ee" })));
        expect(await loadPublicShareViewerContent({ location, fetch })).toMatchObject({ status: "unavailable" });
        expect(await loadPublicShareViewerContent({ location, fetch })).toMatchObject({ status: "invalid_content" });
    });

    it("authenticates encrypted Artifact content using only the fragment secret", async () => {
        const dataKey = new Uint8Array(32).fill(7);
        const encryptedDataKey = sealPublicShareDataKeyV1({ dataKey, secret, randomBytes: length => new Uint8Array(length).fill(2) });
        const encrypted = { ...plain, encryptionMode: "e2ee", encryptedDataKey, content: { ...plain.content,
            header: encodeBase64(await sealSessionDataKeyBundleV0({ title: "Private document" }, dataKey)),
            body: encodeBase64(await sealSessionDataKeyBundleV0({ body: "Opened in this browser" }, dataKey)),
        } };
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify(encrypted)));
        expect(await loadPublicShareViewerContent({ location, fetch })).toMatchObject({ status: "ready", text: "Opened in this browser" });
        expect(await loadPublicShareViewerContent({ location: { ...location, hash: "#k=" + "B".repeat(43) }, fetch })).toMatchObject({ status: "invalid_link" });
        expect(await loadPublicShareViewerContent({ location, fetch: async () => new Response(JSON.stringify({ ...encrypted, content: { ...encrypted.content, body: plain.content.body } })) })).toMatchObject({ status: "invalid_content" });
    });

    it("opens real encrypted Session messages and pages using the owner's grant", async () => {
        const dataKey = new Uint8Array(32).fill(7);
        const encryptedDataKey = sealPublicShareDataKeyV1({ dataKey, secret, randomBytes: length => new Uint8Array(length).fill(2) });
        const response = { subject: { kind: "session", id: "session" }, encryptionMode: "e2ee", encryptedDataKey,
            keyDerivation: "fragment_v1", isConsentRequired: false, messagesAccessToken: "grant",
            content: { kind: "session", metadata: null, metadataVersion: 0, agentState: null, agentStateVersion: 0,
                messages: [{ id: "message", seq: 4, createdAt: 0, content: { t: "encrypted", c: encodeBase64(await sealSessionDataKeyBundleV0({ role: "user", content: { type: "text", text: "Hello" } }, dataKey)) } }],
                hasMore: true, nextBeforeSeq: 4 } };
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(response)));
        expect(await loadPublicShareViewerContent({ location, fetch, beforeSeq: 5, messagesAccessToken: "grant" })).toMatchObject({ status: "ready", text: "Hello", nextBeforeSeq: 4, messagesAccessToken: "grant" });
        expect(fetch.mock.calls[0]).toEqual([`${location.origin}/v1/public-shares/lookup/content?beforeSeq=5`, expect.objectContaining({ headers: { "x-public-share-messages-access-token": "grant" }, credentials: "omit" })]);
    });

    it("renders untrusted content only through text nodes", () => {
        const nodes: Array<{ tag: string; textContent: string | null }> = [];
        // Document is the browser/OS boundary. Its HTML sink rejects writes so the
        // test detects accidental HTML rendering without replacing content logic.
        const root = {
            ownerDocument: { createElement: (tag: string) => ({ tag, textContent: null,
                set innerHTML(_value: string) { throw new Error("HTML sink used"); } }) },
            replaceChildren: (...children: Array<{ tag: string; textContent: string | null }>) => { nodes.push(...children); },
        } as unknown as HTMLElement;
        renderPublicShareViewer(root, { status: "ready", title: "<img onerror=alert(1)>", text: "<script>alert(1)</script>", nextBeforeSeq: null, messagesAccessToken: null });
        expect(nodes).toEqual([{ tag: "h1", textContent: "<img onerror=alert(1)>" }, { tag: "pre", textContent: "<script>alert(1)</script>" }]);
    });

    it("the served browser bundle preserves opened text when an earlier page cannot be reached", async () => {
        const { elements, document } = createBrowserBoundary();
        const response = { subject: { kind: "session", id: "session" }, encryptionMode: "plain", encryptedDataKey: null,
            keyDerivation: "fragment_v1", isConsentRequired: false, messagesAccessToken: "grant", content: {
                kind: "session", metadata: null, metadataVersion: 0, agentState: null, agentStateVersion: 0,
                messages: [{ id: "message", seq: 4, createdAt: 0, content: { t: "plain", v: { content: { type: "text", text: "Opened text" } } } }],
                hasMore: true, nextBeforeSeq: 4,
            } };
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(JSON.stringify(response))).mockRejectedValueOnce(new Error("offline"));
        const viewerLocation = { ...location };
        let fragmentChanged: (() => void) | undefined;
        runInNewContext(PUBLIC_SHARE_VIEWER_SCRIPT, { document, location: viewerLocation, fetch, TextEncoder, TextDecoder, URL, URLSearchParams, crypto: globalThis.crypto, Uint8Array,
            addEventListener: (type: string, callback: () => void) => { if (type === "hashchange") fragmentChanged = callback; } });
        await vi.waitFor(() => expect(elements.find(element => element.tag === "pre")?.textContent).toBe("Opened text"));
        elements.find(element => element.tag === "button")?.click?.();
        await vi.waitFor(() => expect(elements.some(element => element.tag === "p" && element.textContent?.includes("Earlier messages"))).toBe(true));
        expect(elements.find(element => element.tag === "pre")?.textContent).toBe("Opened text");
        viewerLocation.hash = "#k=wrong";
        fragmentChanged?.();
        await vi.waitFor(() => expect(elements.some(element => element.tag === "p" && element.textContent?.includes("incomplete"))).toBe(true));
        expect(elements.some(element => element.tag === "pre")).toBe(false);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("the served browser bundle never renders an in-flight response for a removed fragment", async () => {
        const { elements, document } = createBrowserBoundary();
        const viewerLocation = { ...location };
        let fragmentChanged: (() => void) | undefined;
        let release!: (response: Response) => void;
        const pending = new Promise<Response>(resolve => { release = resolve; });
        const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(pending);
        runInNewContext(PUBLIC_SHARE_VIEWER_SCRIPT, { document, location: viewerLocation, fetch, TextEncoder, TextDecoder, URL, URLSearchParams, crypto: globalThis.crypto, Uint8Array,
            addEventListener: (type: string, callback: () => void) => { if (type === "hashchange") fragmentChanged = callback; } });
        viewerLocation.hash = "";
        fragmentChanged?.();
        await vi.waitFor(() => expect(elements.some(element => element.textContent?.includes("incomplete"))).toBe(true));
        release(new Response(JSON.stringify(plain)));
        // Drain the response's real asynchronous JSON read before checking that
        // the preceding fragment cannot replace the current failure state.
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(elements.some(element => element.tag === "pre")).toBe(false);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
