import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { Modal } from '@/modal';
import { deleteArtifact } from '@/sync/api/artifacts/apiArtifacts';
import { storage, useSettingMutable } from '@/sync/domains/state/storage';
import { duplicatePromptBundle } from '@/sync/ops/promptLibrary/promptBundles';
import { duplicatePromptDoc } from '@/sync/ops/promptLibrary/promptDocs';
import { removePromptLibraryArtifactReferences } from '@/sync/ops/promptLibrary/promptLibraryReferences';
import { sync } from '@/sync/sync';
import { t } from '@/text';

import { buildPromptAssetExportHref } from '../shared/buildPromptAssetExportHref';
import { promptCollectionItemHref } from './promptCollectionModel';

/**
 * The rare operations on a saved prompt or skill, offered by its editor's `⋯` menu: duplicate it
 * (opening the copy), manage where it is exported, and delete it (after confirmation, pruning the
 * templates, system prompt additions and export links that point at it).
 */
export function usePromptLibraryEntryActions(kind: 'doc' | 'bundle') {
    const router = useRouter();
    const [promptInvocationsV1, setPromptInvocationsV1] = useSettingMutable('promptInvocationsV1');
    const [promptStacksV1, setPromptStacksV1] = useSettingMutable('promptStacksV1');
    const [promptExternalLinksV1, setPromptExternalLinksV1] = useSettingMutable('promptExternalLinksV1');

    /** Resolves `true` once the item is gone, so its editor can leave. */
    const remove = React.useCallback(async (artifactId: string): Promise<boolean> => {
        const confirmed = await Modal.confirm(
            t('promptLibrary.deleteLibraryItemTitle'),
            t('promptLibrary.deleteLibraryItemBody'),
            { confirmText: t('common.delete'), destructive: true },
        );
        if (!confirmed) return false;

        const credentials = sync.getCredentials();
        if (!credentials) {
            Modal.alert(t('common.error'), t('errors.unknownError'));
            return false;
        }

        try {
            await deleteArtifact(credentials, artifactId);
        } catch {
            Modal.alert(t('common.error'), t('errors.unknownError'));
            return false;
        }
        storage.getState().deleteArtifact(artifactId);

        const next = removePromptLibraryArtifactReferences({
            artifactId,
            promptInvocationsV1,
            promptStacksV1,
            promptExternalLinksV1,
        });
        setPromptInvocationsV1(next.promptInvocationsV1);
        setPromptStacksV1(next.promptStacksV1);
        setPromptExternalLinksV1(next.promptExternalLinksV1);
        return true;
    }, [promptExternalLinksV1, promptInvocationsV1, promptStacksV1, setPromptExternalLinksV1, setPromptInvocationsV1, setPromptStacksV1]);

    const duplicate = React.useCallback(async (artifactId: string) => {
        try {
            const nextArtifactId = kind === 'doc'
                ? await duplicatePromptDoc(artifactId)
                : await duplicatePromptBundle(artifactId);
            router.push(promptCollectionItemHref(kind, nextArtifactId) as never);
        } catch {
            Modal.alert(t('common.error'), t('errors.unknownError'));
        }
    }, [kind, router]);

    const manageExternalAssets = React.useCallback((artifactId: string) => {
        router.push(buildPromptAssetExportHref({ artifactId, libraryKind: kind }) as never);
    }, [kind, router]);

    return { remove, duplicate, manageExternalAssets } as const;
}
