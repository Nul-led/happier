import { act } from 'react-test-renderer';

/**
 * The two real approval writers a surface test needs around the Home
 * governance harness's stateful Artifact store.
 *
 * Both run the shipped generic executor over the harness's network boundary,
 * so the Artifact codec, the approval subject/transition owner, its CAS writer
 * and the Home family transport all stay real. A test therefore observes only
 * states the product itself can write — never a hand-built terminal record.
 *
 * The executor is imported lazily: the harness installs its boundaries with
 * `vi.doMock`, which only reaches modules imported afterwards.
 */

type Execute = ReturnType<
    typeof import('@/sync/ops/actions/defaultActionExecutor')['createDefaultActionExecutor']
>['execute'];
type ExecuteResult = Awaited<ReturnType<Execute>>;

/**
 * Creates the durable approval request a present-user UI invocation of one
 * Action produces on a Home whose Account requires approval for it
 * (`harness.requireUiApproval`). Returns the created Artifact id.
 */
export async function createUiApprovalRequest(input: Readonly<{
    serverId: string;
    actionId: Parameters<Execute>[0];
    actionInput: Parameters<Execute>[1];
    actionRequestId: string;
}>): Promise<string> {
    const { createDefaultActionExecutor } = await import('@/sync/ops/actions/defaultActionExecutor');
    const executor = createDefaultActionExecutor({ resolveServerIdForSessionId: () => null });
    let result: ExecuteResult | undefined;
    await act(async () => {
        result = await executor.execute(input.actionId, input.actionInput, {
            serverId: input.serverId,
            surface: 'ui',
            authority: 'present_user',
            actionRequestId: input.actionRequestId,
        });
    });
    const created = result as { ok?: unknown; result?: { kind?: unknown; artifactId?: unknown } } | undefined;
    if (created?.ok !== true
        || created.result?.kind !== 'approval_request_created'
        || typeof created.result.artifactId !== 'string') {
        throw new Error(`approval_request_not_created:${JSON.stringify(result)}`);
    }
    return created.result.artifactId;
}

/**
 * Decides a pending approval the way Approval Detail, the Prompt Card and the
 * Inbox do (`useApprovalDecisionHandler`): a generic executor with no mounted
 * port, addressed to the Artifact's Home. Any effect it runs is a replay
 * through the captured Home scope, so a mounted surface can only learn the
 * outcome through the shared approval lifecycle.
 */
export async function decideApprovalAsInbox(
    serverId: string,
    artifactId: string,
    decision: 'approve' | 'reject',
): Promise<ExecuteResult> {
    const { createDefaultActionExecutor } = await import('@/sync/ops/actions/defaultActionExecutor');
    const executor = createDefaultActionExecutor({ resolveServerIdForSessionId: () => null });
    let result: ExecuteResult | undefined;
    await act(async () => {
        result = await executor.execute('approval.request.decide', { artifactId, decision }, {
            surface: 'ui',
            serverId,
        });
    });
    return result!;
}
