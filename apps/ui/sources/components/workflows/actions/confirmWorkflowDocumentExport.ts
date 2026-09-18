import { Modal } from '@/modal';
import { t } from '@/text';
import {
    saveWorkflowDocument,
    workflowDocumentFileName,
} from '@/sync/domains/workflows/workflowDocumentFile';

/**
 * One UI owner for the private-content preview and the existing web/native
 * file boundary. Definition validation and serialization stay with the
 * canonical Workflow codec before this function is called.
 */
export async function confirmWorkflowDocumentExport(params: Readonly<{
    name: string;
    json: string;
    /** Re-check Account/route lifetime after the asynchronous confirmation. */
    isCurrent?: () => boolean;
}>): Promise<boolean> {
    const confirmed = await Modal.confirm(
        t('workflows.exportJson'),
        t('workflows.interchange.exportPrivacyNote'),
        { confirmText: t('workflows.exportJson') },
    );
    if (!confirmed || params.isCurrent?.() === false) return false;
    await saveWorkflowDocument({
        fileName: workflowDocumentFileName(params.name),
        json: params.json,
    });
    return true;
}
