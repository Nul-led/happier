import {
    WORKFLOW_ACTION_IDS_V1,
    parseWorkflowRunStartActionResultReferenceV1,
    type WorkflowActionIdV1,
    type WorkflowRunActionResultReferenceV1,
} from '@happier-dev/protocol/workflows/actionsV1';

import type { ToolCall } from "@happier-dev/session-core/messages";

import {
    createHappierActionToolNameIndex,
    readHappierActionId,
    readHappierActionToolResultCandidates,
} from './happierActionToolResult';

/**
 * The one projection from a transcript tool call to a managed Workflow Run.
 *
 * The agent-origin journey is Agent Action -> exact Session card -> Run detail,
 * and this module owns its only discriminating step: deciding whether a row's
 * recorded tool result *is* the canonical `workflow.run.start` acknowledgement
 * of one exact admitted Run.
 *
 * It reads nothing heuristically. The tool name is matched against the
 * canonical `bindings.mcpToolName` the Action spec owner declares, and the
 * result is validated by the Protocol's own start-result reference parser,
 * which accepts the bare start result and the executor envelope and yields the
 * exact `runId` plus the declared origin. Prose, partial JSON, a lookalike tool
 * from a foreign MCP server, a failure envelope, a deferred approval and the
 * read/control Actions whose results also carry a `run` all produce no
 * reference: only a start acknowledges an admission this row can claim.
 */

export type TranscriptWorkflowRunReference = WorkflowRunActionResultReferenceV1;

const WORKFLOW_ACTION_ID_BY_TOOL_NAME = createHappierActionToolNameIndex<WorkflowActionIdV1>(WORKFLOW_ACTION_IDS_V1);

export function resolveTranscriptWorkflowRunReference(input: Readonly<{
    toolName: string;
    state: ToolCall['state'];
    result: unknown;
}>): TranscriptWorkflowRunReference | null {
    // A running, errored or permission-blocked call has admitted nothing. Only a
    // completed call can carry an acknowledgement worth mounting.
    if (input.state !== 'completed') return null;
    if (readHappierActionId(input.toolName, WORKFLOW_ACTION_ID_BY_TOOL_NAME) !== 'workflow.run.start') return null;

    for (const candidate of readHappierActionToolResultCandidates(input.result)) {
        const reference = parseWorkflowRunStartActionResultReferenceV1(candidate);
        if (reference) return Object.freeze(reference);
    }
    return null;
}
