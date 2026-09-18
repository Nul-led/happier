import { randomUUID } from '@/platform/randomUUID';

export function createUiSurfaceMountIdentity(instanceId?: string): Readonly<{ instanceId: string; mountNonce: string }> | null {
    try {
        return { instanceId: instanceId ?? randomUUID(), mountNonce: randomUUID() };
    } catch {
        // An unavailable secure platform source cannot create a framed peer.
        return null;
    }
}
