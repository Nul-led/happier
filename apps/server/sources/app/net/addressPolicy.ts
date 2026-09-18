import { isIP } from "node:net";

/**
 * One parsing/classification owner for IP address facts.
 *
 * Two very different policies consume these facts and must not be collapsed:
 * inbound request-origin classification (`requestOrigin.ts`) answers "did this
 * request arrive from a private network"; the outbound identity-endpoint policy
 * answers "may this server open a connection to this address". "Not private" for
 * an inbound peer never establishes safe outbound routing, so this module exposes
 * exact categories and lets each policy pick its own union.
 */

export type IpAddressVersion = 4 | 6;

/**
 * Exact, non-overlapping address categories, except `cloudMetadata`, which is
 * additive because some metadata endpoints sit inside otherwise ordinary ranges.
 * `globalUnicast` is set only when no other structural category applies.
 */
export type IpAddressCategory =
    | "loopback"
    | "unspecified"
    | "privateUse"
    | "carrierGradeNat"
    | "linkLocal"
    | "uniqueLocal"
    | "multicast"
    | "documentation"
    | "benchmark"
    | "protocolAssignment"
    | "reserved"
    | "translatedIpv4"
    | "globalUnicast"
    | "cloudMetadata";

export type IpAddressFacts = Readonly<{
    version: IpAddressVersion;
    /** Canonical literal, safe to hand to a socket connector. */
    address: string;
    /** Big-endian address bytes: 4 for IPv4, 16 for IPv6. */
    bytes: readonly number[];
    /**
     * IPv4 recovered from an IPv4-mapped, IPv4-compatible, NAT64, or 6to4 IPv6
     * encoding. Its presence means the literal can smuggle an IPv4 destination
     * past a naive IPv6 check, so outbound policy rejects it outright.
     */
    embeddedIpv4: IpAddressFacts | null;
    categories: ReadonlySet<IpAddressCategory>;
}>;

export type IpCidr = Readonly<{ network: IpAddressFacts; prefixLength: number }>;

function parseIpv4Bytes(raw: string): number[] | null {
    const parts = raw.split(".");
    if (parts.length !== 4) return null;
    const bytes: number[] = [];
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const value = Number(part);
        if (!Number.isInteger(value) || value < 0 || value > 255) return null;
        bytes.push(value);
    }
    return bytes;
}

function parseIpv6Bytes(raw: string): number[] | null {
    // A zone id identifies a local interface and never changes the address bits.
    let value = raw.toLowerCase().split("%")[0] ?? "";
    if (!value.includes(":")) return null;

    const lastColon = value.lastIndexOf(":");
    const trailer = value.slice(lastColon + 1);
    if (trailer.includes(".")) {
        const embedded = parseIpv4Bytes(trailer);
        if (!embedded) return null;
        const high = (((embedded[0] ?? 0) << 8) | (embedded[1] ?? 0)).toString(16);
        const low = (((embedded[2] ?? 0) << 8) | (embedded[3] ?? 0)).toString(16);
        value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
    }

    const sides = value.split("::");
    if (sides.length > 2) return null;
    const head = sides[0] ? sides[0].split(":") : [];
    const tail = sides.length === 2 && sides[1] ? sides[1].split(":") : [];
    for (const group of [...head, ...tail]) {
        if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    }

    const missing = 8 - head.length - tail.length;
    let groups: number[];
    if (sides.length === 1) {
        if (missing !== 0) return null;
        groups = head.map((group) => Number.parseInt(group, 16));
    } else {
        if (missing < 1) return null;
        groups = [
            ...head.map((group) => Number.parseInt(group, 16)),
            ...Array.from({ length: missing }, () => 0),
            ...tail.map((group) => Number.parseInt(group, 16)),
        ];
    }

    const bytes: number[] = [];
    for (const group of groups) {
        bytes.push((group >> 8) & 0xff, group & 0xff);
    }
    return bytes;
}

function formatIpv4(bytes: readonly number[]): string {
    return bytes.join(".");
}

function formatIpv6(bytes: readonly number[]): string {
    const groups: string[] = [];
    for (let index = 0; index < 16; index += 2) {
        groups.push((((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0)).toString(16));
    }
    return groups.join(":");
}

const AZURE_WIREPROBE_IPV4 = [168, 63, 129, 16] as const;
const ALIBABA_METADATA_IPV4 = [100, 100, 100, 200] as const;
const AWS_STYLE_METADATA_IPV4 = [169, 254, 169, 254] as const;
const ORACLE_METADATA_IPV4 = [192, 0, 0, 192] as const;

function isCloudMetadataIpv4(bytes: readonly number[]): boolean {
    return [AZURE_WIREPROBE_IPV4, ALIBABA_METADATA_IPV4, AWS_STYLE_METADATA_IPV4, ORACLE_METADATA_IPV4]
        .some((candidate) => candidate.every((octet, index) => bytes[index] === octet));
}

function classifyIpv4(bytes: readonly number[]): Set<IpAddressCategory> {
    const [a = 0, b = 0, c = 0] = bytes;
    const categories = new Set<IpAddressCategory>();

    // 0.0.0.0/8 is "this network" (RFC 1122); it is never a routable destination.
    if (a === 0) categories.add("unspecified");
    else if (a === 127) categories.add("loopback");
    else if (a === 10) categories.add("privateUse");
    else if (a === 172 && b >= 16 && b <= 31) categories.add("privateUse");
    else if (a === 192 && b === 168) categories.add("privateUse");
    else if (a === 100 && b >= 64 && b <= 127) categories.add("carrierGradeNat");
    else if (a === 169 && b === 254) categories.add("linkLocal");
    else if (a === 192 && b === 0 && c === 0) categories.add("protocolAssignment");
    else if (a === 192 && b === 0 && c === 2) categories.add("documentation");
    else if (a === 198 && b === 51 && c === 100) categories.add("documentation");
    else if (a === 203 && b === 0 && c === 113) categories.add("documentation");
    else if (a === 192 && b === 88 && c === 99) categories.add("reserved");
    else if (a === 198 && (b === 18 || b === 19)) categories.add("benchmark");
    else if (a >= 224 && a <= 239) categories.add("multicast");
    else if (a >= 240) categories.add("reserved");
    else categories.add("globalUnicast");

    if (isCloudMetadataIpv4(bytes)) categories.add("cloudMetadata");
    return categories;
}

function hasPrefix(bytes: readonly number[], prefix: readonly number[]): boolean {
    return prefix.every((value, index) => bytes[index] === value);
}

function extractEmbeddedIpv4Bytes(bytes: readonly number[]): number[] | null {
    // IPv4-mapped ::ffff:0:0/96 and the deprecated IPv4-compatible ::/96.
    if (bytes.slice(0, 10).every((value) => value === 0)) {
        if (bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12, 16);
        if (bytes[10] === 0 && bytes[11] === 0) {
            const tail = bytes.slice(12, 16);
            // :: and ::1 are their own addresses, not encoded IPv4 destinations.
            const isReservedTail = tail[0] === 0 && tail[1] === 0 && tail[2] === 0 && (tail[3] === 0 || tail[3] === 1);
            return isReservedTail ? null : tail;
        }
        return null;
    }
    // NAT64 well-known prefix 64:ff9b::/96.
    if (hasPrefix(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0])) return bytes.slice(12, 16);
    // 6to4 2002::/16 embeds the IPv4 address of the relay endpoint.
    if (hasPrefix(bytes, [0x20, 0x02])) return bytes.slice(2, 6);
    return null;
}

function classifyIpv6(bytes: readonly number[], embeddedIpv4: IpAddressFacts | null): Set<IpAddressCategory> {
    const categories = new Set<IpAddressCategory>();
    const first = bytes[0] ?? 0;
    const second = bytes[1] ?? 0;

    if (embeddedIpv4) categories.add("translatedIpv4");
    else if (bytes.every((value) => value === 0)) categories.add("unspecified");
    else if (bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1) categories.add("loopback");
    else if (first === 0xfe && (second & 0xc0) === 0x80) categories.add("linkLocal");
    else if (first === 0xfe && (second & 0xc0) === 0xc0) categories.add("reserved"); // deprecated site-local fec0::/10
    else if ((first & 0xfe) === 0xfc) categories.add("uniqueLocal");
    else if (first === 0xff) categories.add("multicast");
    else if (hasPrefix(bytes, [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])) categories.add("reserved"); // 100::/64 discard-only
    else if (hasPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8])) categories.add("documentation");
    else if (hasPrefix(bytes, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00])) categories.add("benchmark");
    else if (first === 0x20 && second === 0x01 && ((bytes[2] ?? 0) & 0xfe) === 0x00) categories.add("protocolAssignment");
    else categories.add("globalUnicast");

    return categories;
}

/**
 * Parses an IPv4 or IPv6 literal into exact address facts, including alternative
 * IPv6 encodings (compressed, uncompressed, zone id, dotted or hexadecimal
 * IPv4-mapped forms) that a string-prefix check silently misreads.
 */
export function parseIpAddress(raw: unknown): IpAddressFacts | null {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return null;

    const unbracketed = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;

    if (!unbracketed.includes(":")) {
        const bytes = parseIpv4Bytes(unbracketed);
        if (!bytes) return null;
        return Object.freeze({
            version: 4 as const,
            address: formatIpv4(bytes),
            bytes: Object.freeze(bytes),
            embeddedIpv4: null,
            categories: classifyIpv4(bytes),
        });
    }

    const bytes = parseIpv6Bytes(unbracketed);
    if (!bytes) return null;
    const embeddedBytes = extractEmbeddedIpv4Bytes(bytes);
    const embeddedIpv4 = embeddedBytes
        ? Object.freeze({
            version: 4 as const,
            address: formatIpv4(embeddedBytes),
            bytes: Object.freeze(embeddedBytes),
            embeddedIpv4: null,
            categories: classifyIpv4(embeddedBytes),
        })
        : null;
    return Object.freeze({
        version: 6 as const,
        address: formatIpv6(bytes),
        bytes: Object.freeze(bytes),
        embeddedIpv4,
        categories: classifyIpv6(bytes, embeddedIpv4),
    });
}

/** Parses `<address>/<prefixLength>`. */
export function parseIpCidr(raw: unknown): IpCidr | null {
    const value = typeof raw === "string" ? raw.trim() : "";
    const separator = value.lastIndexOf("/");
    if (separator < 0) return null;
    const network = parseIpAddress(value.slice(0, separator));
    if (!network) return null;
    const prefixRaw = value.slice(separator + 1);
    if (!/^\d{1,3}$/.test(prefixRaw)) return null;
    const prefixLength = Number(prefixRaw);
    if (prefixLength > network.bytes.length * 8) return null;
    return Object.freeze({ network, prefixLength });
}

export function cidrContains(cidr: IpCidr, candidate: IpAddressFacts): boolean {
    if (cidr.network.version !== candidate.version) return false;
    let remaining = cidr.prefixLength;
    for (let index = 0; index < cidr.network.bytes.length; index += 1) {
        if (remaining <= 0) return true;
        const maskBits = Math.min(8, remaining);
        const mask = (0xff << (8 - maskBits)) & 0xff;
        if (((cidr.network.bytes[index] ?? 0) & mask) !== ((candidate.bytes[index] ?? 0) & mask)) return false;
        remaining -= maskBits;
    }
    return true;
}

/**
 * Categories that mean "this peer is inside a private/local network". This is the
 * inbound request-origin union and deliberately excludes documentation, benchmark,
 * multicast, and reserved ranges, which are not private networks even though the
 * outbound policy refuses to connect to them.
 */
const PRIVATE_NETWORK_CATEGORIES: ReadonlySet<IpAddressCategory> = new Set<IpAddressCategory>([
    "loopback",
    "unspecified",
    "privateUse",
    "carrierGradeNat",
    "linkLocal",
    "uniqueLocal",
]);

export function isPrivateNetworkAddress(facts: IpAddressFacts): boolean {
    const effective = facts.embeddedIpv4 ?? facts;
    for (const category of effective.categories) {
        if (PRIVATE_NETWORK_CATEGORIES.has(category)) return true;
    }
    return false;
}

/**
 * True only for addresses a public internet service may legitimately live on.
 * Every structural category, every IPv4-in-IPv6 encoding, and every known cloud
 * metadata endpoint is excluded.
 */
export function isGloballyRoutableAddress(facts: IpAddressFacts): boolean {
    return facts.categories.has("globalUnicast") && !facts.categories.has("cloudMetadata");
}

/** True when `isIP` recognizes the literal, matching the inbound classifier's accepted-input contract. */
export function isRecognizedIpLiteral(raw: string): boolean {
    return isIP(raw) !== 0;
}
