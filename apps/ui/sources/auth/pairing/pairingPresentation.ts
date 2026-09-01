import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

export function formatHomeEnrollmentTargetLabel(descriptor: HomeConnectionDescriptorV1): string {
    try {
        return new URL(descriptor.canonicalServerUrl).host;
    } catch {
        return descriptor.canonicalServerUrl;
    }
}

export function formatEnrollmentExpiry(expiresAtMs: number): string {
    return new Date(expiresAtMs).toLocaleString();
}
