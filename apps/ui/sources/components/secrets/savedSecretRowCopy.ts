import type { SavedSecretCatalogEntryV1 } from '@happier-dev/protocol';

import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import { t } from '@/text';

/** The material status of a shared secret, in the owner's or recipient's words. */
export function sharedSecretStatusLabel(status: SavedSecretCatalogEntryV1['materialStatus']): string {
    switch (status) {
        case 'ready': return t('secrets.catalog.status.ready');
        case 'preparing_encrypted_access': return t('secrets.catalog.status.preparing_encrypted_access');
        case 'recipient_mode_unsupported': return t('secrets.catalog.status.recipient_mode_unsupported');
        case 'temporarily_unavailable': return t('secrets.catalog.status.temporarily_unavailable');
        case 'access_removed': return t('secrets.catalog.status.access_removed');
        case 'deleted': return t('secrets.catalog.status.deleted');
        case 'update_required': return t('secrets.catalog.status.update_required');
    }
}

/**
 * Where a shared secret came from, in the words the Home already projected.
 *
 * Picking a shared secret decides whose credential a Session spends, so the row
 * states the recipient-safe owner and the access that carries it. Both facts are
 * read straight from the catalog projection — nothing is inferred from the
 * focused Home, the Team the surface happens to sit in, or the secret's name —
 * and an owner row states neither, because it is the person's own secret.
 */
export function sharedSecretProvenanceSegments(entry: SavedSecretCatalogEntryV1): readonly string[] {
    const ownerName = entry.owner ? formatAccountDisplayName(entry.owner) : null;
    return [
        ...(entry.relationship === 'recipient' && ownerName
            ? [t('secrets.catalog.provenance.sharedBy', { owner: ownerName })]
            : []),
        ...entry.accessSources.map((source) => {
            if (source.kind === 'account') return t('secrets.catalog.provenance.direct');
            return t('secrets.catalog.provenance.via', {
                source: source.kind === 'group' ? `${source.teamName} · ${source.name}` : source.name,
            });
        }),
    ];
}
