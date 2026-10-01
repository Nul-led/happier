import * as React from 'react';
import { Platform, View } from 'react-native';

import { decodeSessionSplitCanvasDragData } from '@/components/sessions/canvas/sessionSplitCanvasDragData';
import { useSessionSplitCanvasDraggedSessionId } from '@/components/sessions/canvas/useSessionSplitCanvasDragState';
import { Text } from '@/components/ui/text/Text';
import type { WorkflowExistingSessionOption } from '@/sync/domains/workflows/workflowAuthoring';
import { t } from '@/text';

import { workflowEditorStyles } from './workflowEditorStyles';

/**
 * What dropping a Session onto an Agent step would do (07 J19, 04 §5.2 E17):
 * continue it in this step, or refuse because it lives on another machine
 * than the workflow's Where. A Session the host's candidacy owner does not
 * offer at all is not a drop target.
 */
export type WorkflowSessionDropVerdict =
    | Readonly<{ accepted: true; option: WorkflowExistingSessionOption; line: string }>
    | Readonly<{ accepted: false; line: string }>;

export function resolveWorkflowSessionDrop(params: Readonly<{
    sessionId: string;
    /** Every Session the host's candidacy owner can continue, on any machine. */
    candidates: readonly WorkflowExistingSessionOption[];
    /** The workflow's Where machine; `null` while none is chosen. */
    whereMachineId: string | null;
    whereMachineName: string | null;
    machineName: (machineId: string) => string;
}>): WorkflowSessionDropVerdict | null {
    const option = params.candidates.find((candidate) => candidate.sessionId === params.sessionId);
    if (option === undefined) return null;
    if (params.whereMachineId !== null && option.machineId !== params.whereMachineId) {
        return {
            accepted: false,
            line: t('workflows.page.inspector.dropRefused', {
                session: option.label,
                machine: params.machineName(option.machineId),
                where: params.whereMachineName ?? params.machineName(params.whereMachineId),
            }),
        };
    }
    return { accepted: true, option, line: t('workflows.page.inspector.dropContinue', { session: option.label }) };
}

export type WorkflowSessionDrop = Readonly<{
    resolve: (sessionId: string) => WorkflowSessionDropVerdict | null;
    /** Binds the step's conversation to the Session, as one draft change. */
    bind: (stepId: string, option: WorkflowExistingSessionOption) => void;
}>;

/**
 * The web drop target around an Agent step's composer for the existing
 * Session drag payload (`SessionSplitCanvasDragHandle`). The payload travels
 * as `text/plain`, so this handles the drop before the composer's text field
 * can insert it as text; a refused Session states why and writes nothing.
 * Native platforms have no drag source; the Conversation row is their path.
 */
export function WorkflowStepSessionDropZone(props: Readonly<{
    stepId: string;
    /** Absent (read-only, native host, no candidacy), the zone is inert. */
    sessionDrop?: WorkflowSessionDrop;
    testID: string;
    children: React.ReactNode;
}>): React.ReactElement {
    const draggedSessionId = useSessionSplitCanvasDraggedSessionId();
    const { sessionDrop, stepId } = props;
    const verdict = draggedSessionId === null || sessionDrop === undefined ? null : sessionDrop.resolve(draggedSessionId);

    const dropHandlers = React.useMemo(() => (Platform.OS !== 'web' || sessionDrop === undefined ? {} : {
        onDragOver: (event: { preventDefault?: () => void }) => {
            // Accepting the drag is what lets the drop reach this target.
            if (verdict?.accepted === true) event.preventDefault?.();
        },
        onDrop: (event: { preventDefault?: () => void; stopPropagation?: () => void; dataTransfer?: { getData?: (type: string) => string } }) => {
            const decoded = decodeSessionSplitCanvasDragData(event.dataTransfer?.getData?.('text/plain') ?? '');
            if (decoded === null) return;
            // A Session payload is never text for the composer, accepted or not.
            event.preventDefault?.();
            event.stopPropagation?.();
            const dropped = sessionDrop.resolve(decoded.sessionId);
            if (dropped?.accepted === true) sessionDrop.bind(stepId, dropped.option);
        },
    }), [sessionDrop, stepId, verdict?.accepted]);

    return (
        <View testID={props.testID} {...dropHandlers}>
            {props.children}
            {verdict === null ? null : (
                <Text
                    testID={`${props.testID}-hint`}
                    style={verdict.accepted ? workflowEditorStyles.metaAction : workflowEditorStyles.issueText}
                >
                    {verdict.line}
                </Text>
            )}
        </View>
    );
}
