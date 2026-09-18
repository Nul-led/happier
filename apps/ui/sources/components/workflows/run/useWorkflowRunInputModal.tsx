import * as React from 'react';

import type { CustomModalInjectedProps } from '@/modal';
import { t } from '@/text';

import { useWorkflowCardModal } from './useWorkflowCardModal';
import { WorkflowRunInputSheet } from './WorkflowRunInputSheet';

/**
 * The one presenter for the Run-now input sheet.
 *
 * Both admission surfaces need it — the neutral editor's **Run now** and Run
 * detail's **Run again** — and both must present it the same way, through the
 * canonical modal owner. That is what keeps focus return, backdrop dismissal
 * and web portal behaviour correct, and it means Run detail is not destroyed
 * and rebuilt around the sheet: the inspected selection, expansion and scroll
 * are still there when the sheet closes.
 *
 * Closing cancels only the unsubmitted command. The caller's draft, values and
 * pending Run id are untouched.
 */
export type WorkflowRunInputModalProps = React.ComponentProps<typeof WorkflowRunInputSheet>;

function WorkflowRunInputModal(
    props: WorkflowRunInputModalProps & CustomModalInjectedProps,
): React.ReactElement {
    return (
        <WorkflowRunInputSheet
            {...props}
            onCancel={() => {
                props.onCancel();
                props.onClose();
            }}
        />
    );
}

export function useWorkflowRunInputModal(params: Readonly<{
    /** The caller's explicit intent to collect declared inputs. */
    open: boolean;
    /**
     * Sheet props, or `null` while the definition they describe is unread. A
     * null value closes the sheet rather than presenting an empty form.
     */
    props: WorkflowRunInputModalProps | null;
    testID?: string;
}>): void {
    useWorkflowCardModal({
        open: params.open,
        component: WorkflowRunInputModal,
        props: params.props,
        title: t('workflows.inputs.runSheetTitle'),
        testID: params.testID ?? 'workflow-run-inputs-modal',
        ...(params.props === null ? {} : { onRequestClose: params.props.onCancel }),
    });
}
