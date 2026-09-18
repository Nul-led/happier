import { describe, expect, it } from "vitest";

import {
    cidrContains,
    isGloballyRoutableAddress,
    isPrivateNetworkAddress,
    parseIpAddress,
    parseIpCidr,
} from "@/app/net/addressPolicy";

function categoriesOf(raw: string): string[] {
    const facts = parseIpAddress(raw);
    if (!facts) throw new Error(`Expected ${raw} to parse`);
    return [...facts.categories].sort();
}

describe("address facts parsing", () => {
    it("parses alternative IPv6 encodings a string-prefix check misreads", () => {
        // Uncompressed loopback: a literal "::1" comparison calls this a public address.
        expect(categoriesOf("0:0:0:0:0:0:0:1")).toEqual(["loopback"]);
        // Hexadecimal IPv4-mapped form produced by WHATWG URL serialization.
        expect(parseIpAddress("::ffff:7f00:1")?.embeddedIpv4?.address).toBe("127.0.0.1");
        // Dotted IPv4-mapped form.
        expect(parseIpAddress("::ffff:10.0.0.5")?.embeddedIpv4?.address).toBe("10.0.0.5");
        // Zone identifiers select an interface and never change the address bits.
        expect(categoriesOf("fe80::1%eth0")).toEqual(["linkLocal"]);
        // Bracketed URL host form.
        expect(parseIpAddress("[::1]")?.address).toBe("0:0:0:0:0:0:0:1");
    });

    it("rejects malformed literals instead of coercing them", () => {
        expect(parseIpAddress("::ffff:999.0.0.1")).toBeNull();
        expect(parseIpAddress("1:2:3:4:5:6:7")).toBeNull();
        expect(parseIpAddress("1::2::3")).toBeNull();
        expect(parseIpAddress("10.0.0")).toBeNull();
        expect(parseIpAddress("10.0.0.256")).toBeNull();
        expect(parseIpAddress("")).toBeNull();
        expect(parseIpAddress(undefined)).toBeNull();
    });

    it("classifies IPv4 ranges exactly", () => {
        expect(categoriesOf("127.0.0.1")).toEqual(["loopback"]);
        expect(categoriesOf("0.0.0.0")).toEqual(["unspecified"]);
        expect(categoriesOf("10.1.2.3")).toEqual(["privateUse"]);
        expect(categoriesOf("172.15.0.1")).toEqual(["globalUnicast"]);
        expect(categoriesOf("172.16.0.1")).toEqual(["privateUse"]);
        expect(categoriesOf("172.31.255.255")).toEqual(["privateUse"]);
        expect(categoriesOf("172.32.0.1")).toEqual(["globalUnicast"]);
        expect(categoriesOf("192.168.0.5")).toEqual(["privateUse"]);
        expect(categoriesOf("100.64.0.1")).toEqual(["carrierGradeNat"]);
        expect(categoriesOf("169.254.1.1")).toEqual(["linkLocal"]);
        expect(categoriesOf("203.0.113.5")).toEqual(["documentation"]);
        expect(categoriesOf("198.18.0.1")).toEqual(["benchmark"]);
        expect(categoriesOf("224.0.0.1")).toEqual(["multicast"]);
        expect(categoriesOf("255.255.255.255")).toEqual(["reserved"]);
        expect(categoriesOf("93.184.216.34")).toEqual(["globalUnicast"]);
    });

    it("flags cloud metadata endpoints, including one inside public unicast", () => {
        expect(categoriesOf("169.254.169.254")).toEqual(["cloudMetadata", "linkLocal"]);
        // Azure's wireserver is globally routable-looking and is the reason a plain
        // private-range check is not an outbound policy.
        expect(categoriesOf("168.63.129.16")).toEqual(["cloudMetadata", "globalUnicast"]);
        expect(categoriesOf("192.0.0.192")).toEqual(["cloudMetadata", "protocolAssignment"]);
        expect(categoriesOf("100.100.100.200")).toEqual(["carrierGradeNat", "cloudMetadata"]);
    });

    it("classifies IPv6 ranges exactly", () => {
        expect(categoriesOf("::")).toEqual(["unspecified"]);
        expect(categoriesOf("fe80::1")).toEqual(["linkLocal"]);
        expect(categoriesOf("febf::1")).toEqual(["linkLocal"]);
        // 0fe8::/16 is unallocated, not link-local; only a string-prefix check confuses them.
        expect(categoriesOf("fe8::1")).toEqual(["globalUnicast"]);
        expect(categoriesOf("fc00::1")).toEqual(["uniqueLocal"]);
        expect(categoriesOf("fdff::1")).toEqual(["uniqueLocal"]);
        expect(categoriesOf("fec0::1")).toEqual(["reserved"]);
        expect(categoriesOf("ff02::1")).toEqual(["multicast"]);
        expect(categoriesOf("2001:db8::1")).toEqual(["documentation"]);
        expect(categoriesOf("2606:4700::1111")).toEqual(["globalUnicast"]);
    });

    it("treats every IPv4-in-IPv6 encoding as translated, not as ordinary IPv6", () => {
        for (const raw of ["::ffff:10.0.0.5", "::ffff:a00:5", "64:ff9b::10.0.0.5", "2002:a00:5::1", "::10.0.0.5"]) {
            expect(categoriesOf(raw)).toEqual(["translatedIpv4"]);
            expect(parseIpAddress(raw)?.embeddedIpv4?.address).toBe("10.0.0.5");
            expect(isGloballyRoutableAddress(parseIpAddress(raw)!)).toBe(false);
        }
    });

    it("separates the private-network union from global routability", () => {
        // Documentation space is not a private network but is never a public IdP.
        const documentation = parseIpAddress("203.0.113.5")!;
        expect(isPrivateNetworkAddress(documentation)).toBe(false);
        expect(isGloballyRoutableAddress(documentation)).toBe(false);

        const azureMetadata = parseIpAddress("168.63.129.16")!;
        expect(isPrivateNetworkAddress(azureMetadata)).toBe(false);
        expect(isGloballyRoutableAddress(azureMetadata)).toBe(false);

        const publicAddress = parseIpAddress("93.184.216.34")!;
        expect(isPrivateNetworkAddress(publicAddress)).toBe(false);
        expect(isGloballyRoutableAddress(publicAddress)).toBe(true);
    });
});

describe("CIDR containment", () => {
    it("matches inside exact bounds and rejects sibling prefixes and version mismatch", () => {
        const cidr = parseIpCidr("10.20.0.0/20")!;
        expect(cidrContains(cidr, parseIpAddress("10.20.0.1")!)).toBe(true);
        expect(cidrContains(cidr, parseIpAddress("10.20.15.255")!)).toBe(true);
        expect(cidrContains(cidr, parseIpAddress("10.20.16.0")!)).toBe(false);
        expect(cidrContains(cidr, parseIpAddress("10.21.0.1")!)).toBe(false);
        expect(cidrContains(cidr, parseIpAddress("::ffff:10.20.0.1")!)).toBe(false);

        const v6 = parseIpCidr("fd00:abcd::/32")!;
        expect(cidrContains(v6, parseIpAddress("fd00:abcd::9")!)).toBe(true);
        expect(cidrContains(v6, parseIpAddress("fd00:abce::9")!)).toBe(false);

        expect(cidrContains(parseIpCidr("0.0.0.0/0")!, parseIpAddress("8.8.8.8")!)).toBe(true);
        expect(cidrContains(parseIpCidr("10.0.0.1/32")!, parseIpAddress("10.0.0.1")!)).toBe(true);
        expect(cidrContains(parseIpCidr("10.0.0.1/32")!, parseIpAddress("10.0.0.2")!)).toBe(false);
    });

    it("rejects malformed CIDRs", () => {
        expect(parseIpCidr("10.0.0.0")).toBeNull();
        expect(parseIpCidr("10.0.0.0/33")).toBeNull();
        expect(parseIpCidr("fd00::/129")).toBeNull();
        expect(parseIpCidr("nonsense/8")).toBeNull();
    });
});
