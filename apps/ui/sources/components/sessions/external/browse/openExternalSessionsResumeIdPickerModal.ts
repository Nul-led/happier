import type { ExternalSessionsBrowseScopeLock } from './ExternalSessionsBrowseScreen';
import { ExternalSessionsResumeIdPickerModal } from './ExternalSessionsResumeIdPickerModal';

import { Modal } from '@/modal';
import {
    buildCommandSurfaceCardChrome,
    COMMAND_SURFACE_WEB_PLACEMENT,
} from '@/modal/components/card/commandSurfaceCard';
import { t } from '@/text';
import { createDeferredOnce } from '@/modal/async/createDeferredOnce';
import type { ModalPortalTarget } from '@/modal/portal/ModalPortalTarget';

export async function openExternalSessionsResumeIdPickerModal(params: Readonly<{
    lockScope: ExternalSessionsBrowseScopeLock;
    title?: string;
    webPortalTarget?: ModalPortalTarget;
}>): Promise<string | null> {
    const deferred = createDeferredOnce<string | null>();
    Modal.show({
        webPortalTarget: params.webPortalTarget ?? null,
        component: ExternalSessionsResumeIdPickerModal,
        props: {
            lockScope: params.lockScope,
            onResolve: deferred.resolve,
        },
        onRequestClose: () => deferred.resolve(null),
        // The same command-surface card as Search / ⌘K and the Browse route.
        webPlacement: COMMAND_SURFACE_WEB_PLACEMENT,
        chrome: buildCommandSurfaceCardChrome({
            title: params.title ?? t('externalSessions.browseHeaderTitle'),
            testID: 'resume-id-browse-modal',
        }),
        closeOnBackdrop: true,
    });
    return await deferred.promise;
}
