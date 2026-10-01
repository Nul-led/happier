import * as React from 'react';
import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { t } from '@/text';
import { ShareSheet } from '../ShareSheet';
import type { ShareSheetActions, ShareSheetModel, ShareSheetPresentation } from '../shareSheetTypes';
import { createDocumentShareAdapter, type DocumentShareKind } from './documentShareAdapter';
import { useDocumentShareController } from './useDocumentShareController';

export type DocumentShareSheetProps = Readonly<{
    artifactId: string;
    kind: DocumentShareKind;
    /** The document's in-app route for Copy link. */
    linkPath?: string;
    /** The host's existing copy hand-off (for example a workflow's JSON export). */
    onSendCopy?: () => void;
    presentation?: ShareSheetPresentation;
    onRequestClose?: () => void;
    testID?: string;
}>;

const DEFAULT_TEST_ID = 'document-share-editor';

function ScopedDocumentShareSheet(props: DocumentShareSheetProps & Readonly<{ scope: ServerAccountScope }>): React.ReactElement {
    const controller = useDocumentShareController({ artifactId: props.artifactId, scope: props.scope });
    const adapter = createDocumentShareAdapter({
        kind: props.kind,
        grants: controller.grants,
        ...(props.linkPath ? { linkPath: props.linkPath } : {}),
        ...(props.onSendCopy ? { sendCopy: props.onSendCopy } : {}),
        loading: controller.loading,
        ...(controller.issue ? { issue: controller.issue } : {}),
        ...(controller.notice ? { notice: controller.notice } : {}),
        readOnly: !controller.loading && !controller.issue && !controller.model.editable,
        retryContent: controller.retryContent,
    });
    return <ShareSheet model={controller.model} actions={controller.actions} adapter={adapter}
        presentation={props.presentation ?? 'full'} onRequestClose={props.onRequestClose} testID={props.testID ?? DEFAULT_TEST_ID} />;
}

const noop = () => {};
const UNSCOPED_ACTIONS: ShareSheetActions = {
    setQuery: noop, retryDirectory: noop, loadMore: noop, addPrincipal: noop, retryMutation: noop,
    setAccessLevel: noop, requestRemove: noop, confirmRemove: noop, cancelRemove: noop, explain: noop,
};
const UNSCOPED_MODEL: ShareSheetModel = {
    revision: 0, editable: false, stale: false, owner: null, grants: [], directory: { query: '', sections: [] },
};

/**
 * Share a workflow, role or launch profile: the one share sheet with the documents adapter over
 * the Artifact grant Actions. Hosts mount it from their own share slot (see `showDocumentShareSheet`).
 */
export function DocumentShareSheet(props: DocumentShareSheetProps): React.ReactElement {
    const scope = useActiveServerAccountScope();
    if (scope) return <ScopedDocumentShareSheet key={`${scope.serverId}:${scope.accountId}:${props.artifactId}`} {...props} scope={scope} />;
    const adapter = createDocumentShareAdapter({
        kind: props.kind, grants: [], loading: false, readOnly: false, retryContent: noop,
        issue: { code: 'not_authenticated', message: t('shareSheet.documents.errors.unavailable'), retryable: false },
    });
    return <ShareSheet model={UNSCOPED_MODEL} actions={UNSCOPED_ACTIONS} adapter={adapter}
        presentation={props.presentation ?? 'full'} onRequestClose={props.onRequestClose} testID={props.testID ?? DEFAULT_TEST_ID} />;
}
