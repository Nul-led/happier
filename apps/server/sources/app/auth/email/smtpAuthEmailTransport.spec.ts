import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { resolveAuthEmailDelivery, isAuthEmailDeliveryReady } from "./resolveAuthEmailDelivery";

/** Local SMTP system boundary; no connection or message leaves this process. */
async function smtpSandbox(rejectRecipient = false) {
    const messages: string[] = [];
    const recipients: string[] = [];
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.setEncoding("utf8");
        socket.write("220 localhost ESMTP test\r\n");
        let pending = "";
        let data: string[] | null = null;
        socket.on("data", (chunk: string) => {
            pending += chunk;
            while (pending.includes("\r\n")) {
                const end = pending.indexOf("\r\n");
                const line = pending.slice(0, end);
                pending = pending.slice(end + 2);
                if (data !== null) {
                    if (line === ".") {
                        messages.push(data.join("\r\n"));
                        data = null;
                        socket.write("250 message accepted\r\n");
                    } else data.push(line.replace(/^\.\./, "."));
                } else if (/^(EHLO|HELO) /i.test(line)) {
                    socket.write("250-localhost\r\n250 8BITMIME\r\n");
                } else if (/^MAIL FROM:/i.test(line)) {
                    socket.write("250 sender accepted\r\n");
                } else if (/^RCPT TO:/i.test(line)) {
                    recipients.push(line);
                    socket.write(rejectRecipient ? "550 mailbox rejected\r\n" : "250 recipient accepted\r\n");
                } else if (line === "DATA") {
                    data = [];
                    socket.write("354 end with dot\r\n");
                } else if (line === "QUIT") {
                    socket.end("221 bye\r\n");
                } else socket.write("250 OK\r\n");
            }
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("SMTP sandbox did not bind TCP");
    return {
        messages, recipients,
        env: {
            HAPPIER_AUTH_EMAIL_SMTP_HOST: "127.0.0.1",
            HAPPIER_AUTH_EMAIL_SMTP_PORT: String(address.port),
            HAPPIER_AUTH_EMAIL_FROM_ADDRESS: "happier@example.test",
        },
        async close() {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        },
    };
}

const message = {
    kind: "invitation" as const,
    to: { address: "recipient@example.test", normalizedEmail: "recipient@example.test" },
    // Transport/render fixture only: activation consumes the Homes capability builder.
    joinUrl: "https://app.example.test/explicit-home-fixture/join/" + "A".repeat(43),
    homeName: "Example Home", teamName: "Example Team", inviterLabel: "Inviter",
    requestedRole: "member", sharesSessionHistory: false, emailBound: true,
    expiresAt: new Date("2026-09-12T00:00:00Z"),
};

describe("production auth SMTP transport", () => {
    it("sends multipart invitation and inline QR through the default configured binding", async () => {
        const sandbox = await smtpSandbox();
        try {
            expect(isAuthEmailDeliveryReady(sandbox.env)).toBe(true);
            const delivery = resolveAuthEmailDelivery(sandbox.env);
            expect(delivery.isReady).toBe(true);
            expect(await delivery.deliver(message)).toEqual({ status: "sent" });
            expect(sandbox.recipients).toEqual(["RCPT TO:<recipient@example.test>"]);
            expect(sandbox.messages).toHaveLength(1);
            const mime = sandbox.messages[0];
            expect(mime).toContain("Content-Type: multipart/alternative");
            expect(mime).toContain("Content-Type: text/plain");
            expect(mime).toContain("Content-Type: text/html");
            expect(mime).toContain("Content-Type: image/png");
            expect(mime).toContain("Content-ID: <invitation-qr@happier>");
            expect(mime).toContain("Content-Disposition: inline;");
            expect(mime.replace(/=\r\n/g, "")).toContain(message.joinUrl);
        } finally { await sandbox.close(); }
    });

    it("returns a bounded failure when the real SMTP server rejects the recipient", async () => {
        const sandbox = await smtpSandbox(true);
        try {
            expect(await resolveAuthEmailDelivery(sandbox.env).deliver(message)).toEqual({
                status: "failed", reason: "transport_failed", detail: "SMTP submission failed",
            });
            expect(sandbox.messages).toEqual([]);
        } finally { await sandbox.close(); }
    });
});
