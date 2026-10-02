import { createHash } from "node:crypto";
import { z } from "zod";
import type { Fastify } from "../../types";
import { resolveStoredContentPublicShareShell } from "@/app/share/storedContentPublicShare";
import { PUBLIC_SHARE_VIEWER_SCRIPT } from "./publicShareViewerBundle.generated";

const style = "html{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0}main{max-width:48rem;margin:auto;padding:clamp(1rem,4vw,3rem)}h1{overflow-wrap:anywhere}pre{font:inherit;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}button{font:inherit;padding:.75em 1.25em;cursor:pointer}button:focus-visible{outline:2px solid currentColor;outline-offset:3px}";
const styleHash = createHash("sha256").update(style).digest("base64");
const csp = `default-src 'none'; script-src 'self'; style-src 'sha256-${styleHash}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`;

/** Delivery delegates every admission decision to the stored-content share owner. */
export function registerPublicShareViewerRoutes(app: Fastify): void {
    const schema = { params: z.object({ lookupId: z.string().min(1) }).strict() };
    for (const asset of [false, true]) {
        app.get(asset ? "/s/:lookupId/viewer.js" : "/s/:lookupId", { schema }, async (request, reply) => {
            const share = await resolveStoredContentPublicShareShell(request.params.lookupId, request.hostname, process.env, request.ip);
            reply.header("Cache-Control", "no-store");
            reply.header("Referrer-Policy", "no-referrer");
            reply.header("X-Content-Type-Options", "nosniff");
            reply.header("Cross-Origin-Resource-Policy", "same-origin");
            if (!share) return reply.code(404).send({ error: "public_share_unavailable" });
            if ("error" in share) return reply.code(429).send({ error: "rate_limited" });
            if (asset) return reply.type("application/javascript; charset=utf-8").send(PUBLIC_SHARE_VIEWER_SCRIPT);
            reply.header("Content-Security-Policy", csp);
            reply.header("Cross-Origin-Opener-Policy", "same-origin");
            reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
            // Only the encoded lookup enters the asset URL. The fragment has no
            // server representation and no plaintext content is embedded.
            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shared content · Happier</title><style>${style}</style></head><body><main id="public-share-viewer" aria-live="polite"><h1>Shared content</h1><p>Opening shared content…</p></main><script src="/s/${encodeURIComponent(request.params.lookupId)}/viewer.js" defer></script></body></html>`;
            return reply.type("text/html; charset=utf-8").send(html);
        });
    }
}
