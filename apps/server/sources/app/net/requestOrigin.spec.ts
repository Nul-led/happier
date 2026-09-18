import { describe, expect, it } from "vitest";

import { classifyRequestIp } from "@/app/net/requestOrigin";

describe("inbound request origin classification", () => {
    it("keeps the released private-network union", () => {
        for (const raw of [
            "127.0.0.1", "0.0.0.0", "10.0.0.5", "172.16.0.1", "172.31.255.255",
            "192.168.0.5", "100.64.0.1", "169.254.1.1",
            "::1", "::", "fe80::1", "fc00::1", "fd12::9",
            "::ffff:192.168.0.5",
        ]) {
            expect(classifyRequestIp(raw), raw).toBe("private");
        }
    });

    it("keeps addresses outside that union public, including ranges the outbound policy denies", () => {
        for (const raw of [
            "203.0.113.5", "8.8.8.8", "172.15.0.1", "172.32.0.1",
            "224.0.0.1", "198.18.0.1", "2606:4700::1111",
        ]) {
            expect(classifyRequestIp(raw), raw).toBe("public");
        }
    });

    it("keeps unrecognized literals unknown", () => {
        expect(classifyRequestIp("not-an-ip")).toBe("unknown");
        expect(classifyRequestIp("")).toBe("unknown");
        expect(classifyRequestIp(undefined)).toBe("unknown");
        expect(classifyRequestIp(42)).toBe("unknown");
        // Leading-zero IPv4 is outside the accepted input contract.
        expect(classifyRequestIp("010.1.1.1")).toBe("unknown");
        // Node accepts an IPv6 zone identifier and the released classifier treats
        // the textual link-local prefix as private.
        expect(classifyRequestIp("fe80::1%eth0")).toBe("private");
    });

    it("preserves the released dotted mapped-address behavior", () => {
        expect(classifyRequestIp("::ffff:010.1.1.1")).toBe("private");
        // The inbound classifier is a released compatibility surface. These forms
        // were outside its private union even though the stricter outbound policy
        // correctly recognizes and rejects them.
        expect(classifyRequestIp("::ffff:7f00:1")).toBe("public");
        expect(classifyRequestIp("0:0:0:0:0:0:0:1")).toBe("public");
    });

    it("preserves the released textual IPv6 private union", () => {
        // The former classifier used these textual prefixes. Preserve that inbound
        // semantic while the outbound policy uses canonical address facts.
        expect(classifyRequestIp("fe8::1")).toBe("private");
    });
});
