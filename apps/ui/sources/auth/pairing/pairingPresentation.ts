import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

export function formatHomeEnrollmentTargetLabel(descriptor: HomeConnectionDescriptorV1): string {
    try {
        return new URL(descriptor.canonicalServerUrl).host;
    } catch {
        return descriptor.canonicalServerUrl;
    }
}

export function formatPairingConfirmationCode(code: string): string {
    return /^\d{6}$/u.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function formatEnrollmentExpiry(expiresAtMs: number): string {
    return new Date(expiresAtMs).toLocaleString();
}
