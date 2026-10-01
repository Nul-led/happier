import {
    openSealedProviderAccountUsageSnapshot,
    type ProviderAccountUsageSnapshotV1,
    type SealedProviderAccountUsageSnapshotV1,
} from '@happier-dev/protocol';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '../resolveAccountScopedCryptoMaterialFromCredentials';

export function openProviderAccountUsageSnapshot(
    credentials: AuthCredentials,
    content:
        | SealedProviderAccountUsageSnapshotV1
        | Readonly<{
            t: 'encrypted';
            c: string;
            subscription?: SealedProviderAccountUsageSnapshotV1['subscription'];
        }>,
): ProviderAccountUsageSnapshotV1 | null {
    const material = resolveAccountScopedCryptoMaterialFromCredentials(credentials);
    return openSealedProviderAccountUsageSnapshot({
        material,
        sealed: 't' in content
            ? {
                format: 'account_scoped_v1',
                ciphertext: content.c,
                ...(content.subscription ? { subscription: content.subscription } : {}),
            }
            : content,
    });
}
