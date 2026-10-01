import * as React from 'react';

import { buildSessionOrganizationTagLabelById } from '@/sync/domains/session/organization/tagLabels';
import { buildSessionOrganizationListViewState } from '@/sync/domains/session/organization/viewState';
import { useActiveServerAccountScope, useSessionOrganizationProjection } from '@/sync/store/hooks';

export type EmbedOrganizationNames = Readonly<{
    serverId: string | null;
    folderName: (folderId: string) => string | null;
    tagLabel: (tagId: string) => string | null;
}>;

/** Folder names and tag labels of the active Home, the one the embed tokens belong to. */
export function useEmbedOrganizationNames(): EmbedOrganizationNames {
    const serverId = useActiveServerAccountScope()?.serverId ?? null;
    const projection = useSessionOrganizationProjection(serverId);
    return React.useMemo(() => {
        const viewState = buildSessionOrganizationListViewState({ serverId: serverId ?? '', projection });
        const folders = new Map(viewState.sessionFoldersV1.folders.map((folder) => [folder.id, folder.name]));
        const tags = buildSessionOrganizationTagLabelById(projection?.tagsById ?? {});
        return {
            serverId,
            folderName: (folderId) => folders.get(folderId) ?? null,
            tagLabel: (tagId) => tags[tagId] ?? null,
        };
    }, [projection, serverId]);
}
