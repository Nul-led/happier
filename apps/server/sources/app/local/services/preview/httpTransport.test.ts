import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import tls from "node:tls";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { LocalServicePreviewResourceV1 } from "@happier-dev/protocol";
import { proxyLocalServicePreviewHttpRequest, type OpenLocalServicePreviewTunnel } from "./httpAdapter";
import { registerLocalServicePreviewRoutes } from "@/app/api/routes/local/services/preview/registerRoutes";
import { registerLocalServicePublicRoutes } from "@/app/api/routes/local/services/public/registerRoutes";
import { proxyLocalServicePreviewWebSocketUpgrade } from "./websocketAdapter";

const servers: Server[] = [];
afterEach(async () => {
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

async function upstream(handler: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void) {
    const server = createServer(handler);
    return listenUpstream(server, "http");
}

async function listenUpstream(server: Server, scheme: "http" | "https", host = "127.0.0.1") {
    servers.push(server);
    server.listen(0, host);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing TCP address");
    const preview: LocalServicePreviewResourceV1 = {
        previewId: "preview_transport", sessionId: "session", machineId: "machine",
        owner: { kind: "session", id: "session" },
        target: { scheme, host, port: address.port },
        initialPath: { pathname: "/", search: "" }, display: { title: "fixture", addressLabel: "fixture" }, originMode: "host",
    };
    const openTunnel: OpenLocalServicePreviewTunnel = async () => {
        const socket = connect(address.port, host);
        await once(socket, "connect");
        return {
            tunnelId: "tcp", substreamId: "stream",
            write: (bytes) => new Promise<void>((resolve, reject) => socket.write(bytes, (error) => error ? reject(error) : resolve())),
            endWrite: () => { socket.end(); },
            read: () => socket,
            close: () => { socket.destroy(); },
            abort: () => { socket.destroy(); },
        };
    };
    return { preview, openTunnel };
}

async function proxy(fixture: Awaited<ReturnType<typeof upstream>>, headers: IncomingHttpHeaders = {}, externalProtocol: "http" | "https" = "http") {
    let status = 0;
    let responseHeaders: Readonly<Record<string, string | readonly string[]>> = {};
    let failure: unknown;
    const bytes: Uint8Array[] = [];
    const request = { method: "GET", path: "/", search: "", headers, externalProtocol };
    const result = await proxyLocalServicePreviewHttpRequest({
        ...fixture,
        request,
        response: {
            writeHead(code, _message, headers) { status = code; responseHeaders = headers; }, write(chunk) { bytes.push(chunk); }, end() {}, destroy(error) { failure = error; },
        },
    });
    return { result, status, body: Buffer.concat(bytes), failure, headers: responseHeaders };
}

async function echoRequest(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) {
    try {
        const body: Uint8Array[] = [];
        for await (const chunk of request) body.push(chunk);
        response.end(Buffer.concat(body));
    } catch (error) {
        // A malformed upload is observable at the real TCP boundary, not an unhandled fixture promise.
        response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
}

describe("preview native HTTP transport", () => {
    it("bootstraps only cooperative HTML navigations, preserves CSP and decodes upstream gzip", async () => {
        const { gzipSync } = await import("node:zlib");
        const html = '<!doctype html><html><head><title>Preview</title></head><body>café</body></html>';
        let upstreamSearch = "";
        let acceptEncoding = "";
        const fixture = await upstream((request, response) => {
            upstreamSearch = request.url ?? "";
            acceptEncoding = String(request.headers["accept-encoding"]);
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.setHeader("Content-Security-Policy", "script-src 'self'");
            response.setHeader("Content-Encoding", "gzip");
            response.end(gzipSync(html));
        });
        const config = { browserSessionId: "bs", viewId: "v", navigationGeneration: 1,
            collector: { collectorId: "c", nonce: "pane_nonce", version: "1.0.0" }, webPostMessageTargetOrigin: "https://app.example.test" };
        const bytes: Uint8Array[] = [];
        let headers: Readonly<Record<string, string | readonly string[]>> = {};
        const result = await proxyLocalServicePreviewHttpRequest({ ...fixture,
            request: { method: "GET", path: "/", search: `?app=1&__happierCollector=${encodeURIComponent(JSON.stringify(config))}`, headers: { host: "preview.example.test", "sec-fetch-dest": "iframe" } },
            response: { writeHead(_code, _message, value) { headers = value; }, write(chunk) { bytes.push(chunk); }, end() {}, destroy() {} },
        });
        expect(result).toEqual({ ok: true });
        expect(acceptEncoding).toBe("identity");
        expect(upstreamSearch).toBe("/?app=1");
        expect(headers["content-security-policy"]).toBe("script-src 'self'");
        expect(headers["content-encoding"]).toBeUndefined();
        expect(headers["content-length"]).toBeUndefined();
        expect(Buffer.concat(bytes).toString()).toContain('/__happier/collector-loader.js?n=pane_nonce');
        expect(Buffer.concat(bytes).toString()).toContain('café');
        expect((await proxy(fixture)).body.equals(gzipSync(html))).toBe(true);
    });

    it("reports a typed cooperative collector refusal without weakening a restrictive CSP", async () => {
        const fixture = await upstream((_request, response) => {
            response.setHeader("Content-Type", "text/html");
            response.setHeader("Content-Security-Policy", "script-src 'none'");
            response.end("<html><head></head><body>blocked</body></html>");
        });
        const config = { browserSessionId: "bs", viewId: "v", navigationGeneration: 1,
            collector: { collectorId: "c", nonce: "nonce", version: "1.0.0" }, webPostMessageTargetOrigin: "https://app.example.test" };
        let headers: Readonly<Record<string, string | readonly string[]>> = {};
        const bytes: Uint8Array[] = [];
        await proxyLocalServicePreviewHttpRequest({ ...fixture,
            request: { method: "GET", path: "/", search: `?__happierCollector=${encodeURIComponent(JSON.stringify(config))}`, headers: { host: "preview.example.test" } },
            response: { writeHead(_code, _message, value) { headers = value; }, write(chunk) { bytes.push(chunk); }, end() {}, destroy() {} },
        });
        expect(headers["x-happier-collector-state"]).toBe("collector_blocked_by_csp");
        expect(headers["content-security-policy"]).toBe("script-src 'none'");
        expect(Buffer.concat(bytes).toString()).not.toContain("collector-loader.js");
    });

    it("preserves the IPv6 loopback authority for HTTP and same-preview Origin", async () => {
        let receivedHeaders: IncomingHttpHeaders = {};
        const fixture = await listenUpstream(createServer((request, response) => {
            receivedHeaders = request.headers;
            response.setHeader("Location", `http://${request.headers.host}/next`);
            response.end("ipv6");
        }), "http", "::1");
        fixture.preview.policy = {
            allowedMethods: ["GET"], cookiePolicy: "rewrite", compressionPolicy: "identity", redirectPolicy: "rewrite_path_mode",
            maxRequestBodyBytes: 1024, maxResponseBodyBytes: 1024,
        };
        const result = await proxy(fixture, { host: "preview.example.test", origin: "https://preview.example.test" }, "https");
        expect(result.result).toEqual({ ok: true });
        expect(result.body.toString()).toBe("ipv6");
        expect(receivedHeaders.host).toBe(`[::1]:${fixture.preview.target.port}`);
        expect(receivedHeaders.origin).toBe(`http://[::1]:${fixture.preview.target.port}`);
        expect(result.headers.location).toBe("/next");
    });

    it("negotiates trusted TLS over the tunnel and rejects untrusted certificates", async () => {
        const scratch = await mkdtemp(join(tmpdir(), "happier-preview-tls-"));
        // The Node 24 test host has this native trust-store API; retained Node 22 typings do not.
        const trustStore = tls as unknown as { getCACertificates(): string[]; setDefaultCACertificates(certs: string[]): void };
        const originalTrust = trustStore.getCACertificates();
        try {
            const keyPath = join(scratch, "key.pem");
            const certPath = join(scratch, "cert.pem");
            await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath,
                "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1"]);
            const cert = await readFile(certPath, "utf8");
            const fixture = await listenUpstream(createHttpsServer({ key: await readFile(keyPath), cert }, (_request, response) => response.end("tls-body")), "https");
            trustStore.setDefaultCACertificates([...originalTrust, cert]);
            expect((await proxy(fixture)).body.toString()).toBe("tls-body");
            const wrongIdentity = await proxy({ ...fixture, preview: { ...fixture.preview,
                target: { ...fixture.preview.target, host: "127.0.0.2" } } });
            expect(wrongIdentity.result).toEqual({ ok: false, reasonCode: "upstream_stream_failed" });
            expect(wrongIdentity.failure).toBeInstanceOf(Error);
            trustStore.setDefaultCACertificates(originalTrust);
            const denied = await proxy(fixture);
            expect(denied.result).toEqual({ ok: false, reasonCode: "upstream_stream_failed" });
            expect(denied.failure).toBeInstanceOf(Error);
        } finally {
            trustStore.setDefaultCACertificates(originalTrust);
            await rm(scratch, { recursive: true, force: true });
        }
    });
    it("decodes chunked SSE framing and preserves binary range bytes", async () => {
        let completeSse: () => void = () => { throw new Error("SSE upstream has not received the request"); };
        const sse = await upstream((_request, response) => {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.write("data: first\n\n");
            completeSse = () => response.end("data: second\n\n");
        });
        const events: Uint8Array[] = [];
        let firstForwarded = false;
        await proxyLocalServicePreviewHttpRequest({ ...sse,
            request: { method: "GET", path: "/", search: "", headers: {} },
            response: { writeHead() {}, write(chunk) {
                events.push(chunk);
                // The second event cannot exist until the first reaches the downstream sink.
                if (!firstForwarded && Buffer.concat(events).includes("data: first\n\n")) {
                    firstForwarded = true;
                    completeSse();
                }
            }, end() {}, destroy(error) { throw error; } },
        });
        expect(Buffer.concat(events).toString()).toBe("data: first\n\ndata: second\n\n");
        const range = await upstream((_request, response) => {
            response.writeHead(206, { "content-range": "bytes 1-3/5", "content-length": "3" });
            response.end(Buffer.from([0, 255, 128]));
        });
        const result = await proxy(range, { range: "bytes=1-3" });
        expect(result.status).toBe(206);
        expect(result.body).toEqual(Buffer.from([0, 255, 128]));
    });

    it("streams unknown-length request bodies using native chunk framing", async () => {
        const fixture = await upstream(echoRequest);
        const bytes: Uint8Array[] = [];
        const result = await proxyLocalServicePreviewHttpRequest({ ...fixture,
            request: { method: "PUT", path: "/", search: "", headers: { "content-type": "application/octet-stream" },
                body: (async function* () { yield Buffer.from([0, 255]); yield Buffer.from([13, 10]); })() },
            response: { writeHead() {}, write(chunk) { bytes.push(chunk); }, end() {}, destroy(error) { throw error; } },
        });
        expect(result).toEqual({ ok: true });
        expect(Buffer.concat(bytes)).toEqual(Buffer.from([0, 255, 13, 10]));
    });

    it("round-trips app cookies and maps same-preview origin metadata while stripping authority and spoofed forwarding", async () => {
        let received: IncomingHttpHeaders = {};
        const fixture = await upstream((request, response) => {
            received = request.headers;
            response.end("ok");
        });
        fixture.preview.policy = {
            allowedMethods: ["GET"], cookiePolicy: "rewrite", compressionPolicy: "identity", redirectPolicy: "rewrite_path_mode",
            maxRequestBodyBytes: 1024, maxResponseBodyBytes: 1024,
        };
        await proxy(fixture, { host: "app.preview.test", origin: "https://app.preview.test", referer: "https://app.preview.test/page?q=1",
            cookie: "happier_preview_token=secret; happier_public_token=secret2; sid=app", "x-forwarded-proto": "spoof", forwarded: "spoof" }, "https");
        expect(received.cookie).toBe("sid=app");
        expect(received.origin).toBe(`http://127.0.0.1:${fixture.preview.target.port}`);
        expect(received.referer).toBe(`http://127.0.0.1:${fixture.preview.target.port}/page?q=1`);
        expect(received["x-forwarded-proto"]).toBe("https");
        expect(received.forwarded).toBeUndefined();
    });

    it("routes raw multipart and whitespace-preserving JSON without changing control API parsing", async () => {
        const fixture = await upstream(echoRequest);
        const app = Fastify();
        app.decorate("authenticate", async () => {});
        app.post("/control", async (request) => ({ parsed: request.body }));
        registerLocalServicePreviewRoutes(app as never, { ...fixture, resolvePreview: () => fixture.preview,
            resolvePreviewByHost: (host) => host === "app.preview.test" ? fixture.preview : null,
            hostOriginBaseDomain: "preview.test", validateAccess: () => ({ ok: true }) });
        try {
            for (const [contentType, payload] of [
                ["application/json", '{  "a" : 1  }'],
                ["multipart/form-data; boundary=fixture", "--fixture\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\nraw\r\n--fixture--\r\n"],
            ]) {
                const response = await app.inject({ method: "PATCH", url: "/", headers: { host: "app.preview.test", "content-type": contentType }, payload });
                expect(response.statusCode).toBe(200);
                expect(response.body).toBe(payload);
            }
            const control = await app.inject({ method: "POST", url: "/control", headers: { "content-type": "application/json" }, payload: '{ "a": 1 }' });
            expect(control.json()).toEqual({ parsed: { a: 1 } });
        } finally { await app.close(); }
    });

    it("preserves public application JSON and multipart bytes without changing control JSON parsing", async () => {
        // Reply on the first small payload chunk: a corrupted JSON upload retains the original
        // Content-Length, so waiting for request EOF would conceal the byte mismatch as a timeout.
        let forwardedProtocol: string | string[] | undefined;
        const fixture = await upstream((request, response) => {
            forwardedProtocol = request.headers["x-forwarded-proto"];
            request.once("data", (chunk) => response.end(chunk));
        });
        const app = Fastify({ trustProxy: true });
        app.decorate("authenticate", async () => {});
        app.post("/control", async (request) => ({ parsed: request.body }));
        registerLocalServicePublicRoutes(app as never, {
            ...fixture, resolvePreview: () => fixture.preview,
            createExposure: () => ({ ok: false, reasonCode: "public_origin_unavailable" }),
            revokeExposure: () => ({ ok: true }),
            validateAccess: () => ({ ok: true, preview: fixture.preview }),
        });
        try {
            for (const [contentType, payload] of [
                ["application/json", '{  "a" : 1  }'],
                ["multipart/form-data; boundary=fixture", "--fixture\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\nraw\r\n--fixture--\r\n"],
            ]) {
                const response = await app.inject({ method: "PATCH", url: "/v1/local-services/public/exposure/upload", headers: { "content-type": contentType, "x-forwarded-proto": "https" }, payload });
                expect(response.statusCode).toBe(200);
                expect(response.body).toBe(payload);
                expect(forwardedProtocol).toBe("https");
            }
            const control = await app.inject({ method: "POST", url: "/control", headers: { "content-type": "application/json" }, payload: '{ "a": 1 }' });
            expect(control.json()).toEqual({ parsed: { a: 1 } });
        } finally { await app.close(); }
    });

    it("reconnects origin-checking HMR upgrades with application cookies and preserved subprotocol", async () => {
        const fixture = await upstream((_request, response) => response.end());
        const server = servers.at(-1)!;
        fixture.preview.policy = {
            allowedMethods: ["GET"], cookiePolicy: "rewrite", compressionPolicy: "identity", redirectPolicy: "rewrite_path_mode",
            maxRequestBodyBytes: 1024, maxResponseBodyBytes: 1024,
        };
        server.on("upgrade", (request, socket) => {
            if (request.headers.origin !== `http://127.0.0.1:${fixture.preview.target.port}` || request.headers.cookie !== "sid=app") {
                socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
                return;
            }
            const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
            socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n`);
            socket.on("data", () => socket.end(Buffer.from([0x81, 2, 0x6f, 0x6b])));
        });
        for (let reconnect = 0; reconnect < 2; reconnect += 1) {
            const output: Uint8Array[] = [];
            const headers = {
                host: "app.preview.test", origin: "https://app.preview.test", cookie: "happier_preview_token=secret; sid=app",
                connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13", "sec-websocket-protocol": "vite-hmr",
            };
            const result = await proxyLocalServicePreviewWebSocketUpgrade({ ...fixture, request: {
                path: "/hmr", search: "", headers, rawHeaders: Object.entries(headers).flat(),
                client: {
                    read: async function* () { yield Buffer.from([0x81, 0x80, 0, 0, 0, 0]); },
                    write(chunk) { output.push(chunk); }, end() {}, destroy() {},
                },
            } });
            expect(result).toEqual({ ok: true });
            const received = Buffer.concat(output);
            expect(received.toString()).toContain("101 Switching Protocols");
            expect(received.toString().toLowerCase()).toContain("sec-websocket-protocol: vite-hmr");
            expect(received.subarray(-4)).toEqual(Buffer.from([0x81, 2, 0x6f, 0x6b]));
        }
    });
});
