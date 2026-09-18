import { toASCII } from 'tr46';

export const VERIFIED_EMAIL_MAX_SCALARS = 320;

export interface NormalizedVerifiedEmail {
    address: string;
    normalizedEmail: string;
}

/**
 * Parse one mailbox for native login and verified-mailbox evidence. This is
 * syntax/canonicalization only; a successful parse does not prove ownership.
 */
export function normalizeVerifiedEmail(input: string): NormalizedVerifiedEmail | null {
    const address = input.trim();
    if (!address || Array.from(address).length > VERIFIED_EMAIL_MAX_SCALARS) return null;
    // Reject malformed UTF-16 rather than allowing platform replacement bytes.
    for (const scalar of address) {
        const code = scalar.codePointAt(0)!;
        if (code >= 0xd800 && code <= 0xdfff) return null;
    }
    const separator = address.indexOf('@');
    if (separator <= 0 || separator !== address.lastIndexOf('@')) return null;
    const local = address.slice(0, separator);
    const domain = address.slice(separator + 1);
    // V1 accepts a dot-atom mailbox, not display names, lists or quoted headers.
    // No provider-specific dot or plus-address transformation is performed.
    if (!/^[\p{L}\p{N}\p{M}!#$%&'*+\-/=?^_`{|}~.]+$/u.test(local)
        || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
    if (!domain || /[\s\p{C}:/\\?#@%\[\]]/u.test(domain)) return null;
    // React Native's URL implementation does not canonicalize IDNs. One
    // package-owned UTS46 implementation keeps mailbox equality identical.
    const asciiDomain = toASCII(domain, {
        checkBidi: true,
        checkHyphens: true,
        checkJoiners: true,
        useSTD3ASCIIRules: true,
        transitionalProcessing: false,
    });
    if (!asciiDomain || !asciiDomain.split('.').every((label) =>
        label.length >= 1 && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))) return null;
    const presentation = `${local}@${asciiDomain}`;
    const normalizedEmail = presentation.toLowerCase();
    if (Array.from(presentation).length > VERIFIED_EMAIL_MAX_SCALARS
        || Array.from(normalizedEmail).length > VERIFIED_EMAIL_MAX_SCALARS) return null;
    return { address: presentation, normalizedEmail };
}
