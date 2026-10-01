import * as React from 'react';

import type { PageHeaderMetaFact } from '@/components/ui/layout/PageHeader';
import { useArtifact, useSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';

/**
 * The facts that tell a saved prompt or skill apart, for its editor header: where it came from
 * (imported, built in) and how many places it is exported to. A new draft has none.
 */
export function usePromptLibraryEntryMeta(artifactId: string | null): readonly PageHeaderMetaFact[] {
    const artifact = useArtifact(artifactId ?? '');
    const links = useSetting('promptExternalLinksV1');
    const origin = artifactId && typeof artifact?.header?.origin === 'string' ? artifact.header.origin : null;
    const exportCount = artifactId ? (links?.links ?? []).filter((link) => link.artifactId === artifactId).length : 0;
    return React.useMemo(() => {
        const facts: PageHeaderMetaFact[] = [];
        if (origin === 'imported') facts.push({ key: 'origin', text: t('promptLibrary.imported') });
        if (origin === 'built_in') facts.push({ key: 'origin', text: t('promptLibrary.builtIn') });
        if (exportCount > 0) facts.push({ key: 'exports', text: t('promptLibrary.linkedAssetsCount', { count: exportCount }) });
        return facts;
    }, [exportCount, origin]);
}
