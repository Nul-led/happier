import type { z } from 'zod';
import {
    getActionSpec,
    homeDomainActionInputSchemaV1,
    homeDomainActionOutputSchemaV1,
    type ManagedIdentityProviderActionIdV1,
    ManagedIdentityProviderCreateInputV1Schema,
    ManagedIdentityProviderLifecycleInputV1Schema,
    ManagedIdentityProviderRemovePreflightInputV1Schema,
    ManagedIdentityProviderRemovePreflightResultV1Schema,
    ManagedIdentityProviderRemoveResultV1Schema,
    ManagedIdentityProviderSecretReplaceInputV1Schema,
    ManagedIdentityProviderTestConsumeInputV1Schema,
    ManagedIdentityProviderTestConsumeResultV1Schema,
    ManagedIdentityProviderTestStartInputV1Schema,
    ManagedIdentityProviderTestStartResultV1Schema,
    ManagedIdentityProvidersListInputV1Schema,
    ManagedIdentityProvidersListResultV1Schema,
    ManagedIdentityProviderUpdateInputV1Schema,
    ManagedIdentityProviderV1Schema,
    ManagedOidcIdentityProviderV1Schema,
} from '@happier-dev/protocol';

import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { homeDomainFailureCode } from '@/sync/api/home/homeDomainActions';
import { scopedHomeActionExecutor } from '@/sync/ops/actions/scopedHomeActionExecutor';
import { classifyHomeActionOutcome } from '@/sync/ops/home/homeActionOutcome';
import { resolveIdentityAdministrationFailureRetryable } from '@/components/settings/identity/identityAdministrationFailure';
import {
    createHomeActionApprovalContinuation,
    type ActionApprovalContinuation,
} from '@/components/approvals/actionApprovalContinuation';

type ManagedIdentityProviderActionInputMap = Readonly<{
    'identity.providers.list': z.infer<typeof ManagedIdentityProvidersListInputV1Schema>;
    'identity.providers.create': z.infer<typeof ManagedIdentityProviderCreateInputV1Schema>;
    'identity.providers.update': z.infer<typeof ManagedIdentityProviderUpdateInputV1Schema>;
    'identity.providers.secret.replace': z.infer<typeof ManagedIdentityProviderSecretReplaceInputV1Schema>;
    'identity.providers.validate': z.infer<typeof ManagedIdentityProviderLifecycleInputV1Schema>;
    'identity.providers.test.start': z.infer<typeof ManagedIdentityProviderTestStartInputV1Schema>;
    'identity.providers.test.consume': z.infer<typeof ManagedIdentityProviderTestConsumeInputV1Schema>;
    'identity.providers.enable': z.infer<typeof ManagedIdentityProviderLifecycleInputV1Schema>;
    'identity.providers.disable': z.infer<typeof ManagedIdentityProviderLifecycleInputV1Schema>;
    'identity.providers.remove.preview': z.infer<typeof ManagedIdentityProviderRemovePreflightInputV1Schema>;
    'identity.providers.remove': z.infer<typeof ManagedIdentityProviderRemovePreflightInputV1Schema>;
}>;

type ManagedIdentityProviderActionOutputMap = Readonly<{
    'identity.providers.list': z.infer<typeof ManagedIdentityProvidersListResultV1Schema>;
    'identity.providers.create': z.infer<typeof ManagedOidcIdentityProviderV1Schema>;
    'identity.providers.update': z.infer<typeof ManagedOidcIdentityProviderV1Schema>;
    'identity.providers.secret.replace': z.infer<typeof ManagedOidcIdentityProviderV1Schema>;
    'identity.providers.validate': z.infer<typeof ManagedOidcIdentityProviderV1Schema>;
    'identity.providers.test.start': z.infer<typeof ManagedIdentityProviderTestStartResultV1Schema>;
    'identity.providers.test.consume': z.infer<typeof ManagedIdentityProviderTestConsumeResultV1Schema>;
    'identity.providers.enable': z.infer<typeof ManagedIdentityProviderV1Schema>;
    'identity.providers.disable': z.infer<typeof ManagedIdentityProviderV1Schema>;
    'identity.providers.remove.preview': z.infer<typeof ManagedIdentityProviderRemovePreflightResultV1Schema>;
    'identity.providers.remove': z.infer<typeof ManagedIdentityProviderRemoveResultV1Schema>;
}>;

export type ManagedIdentityProviderActionResult<TValue> =
    | Readonly<{ kind: 'succeeded'; value: TValue }>
    | Readonly<{ kind: 'approval_pending'; artifactId: string; approval: ActionApprovalContinuation }>
    | Readonly<{ kind: 'failed'; failure: Readonly<{ code: string; retryable: boolean }> }>;

export type ManagedIdentityProviderClient = Readonly<{
    execute: <TActionId extends ManagedIdentityProviderActionIdV1>(
        actionId: TActionId,
        input: ManagedIdentityProviderActionInputMap[TActionId],
        options?: Readonly<{
            signal?: AbortSignal;
            onApprovalSucceeded?: (value: ManagedIdentityProviderActionOutputMap[TActionId]) => void | Promise<void>;
            onApprovalFailed?: (code: string) => void;
        }>,
    ) => Promise<ManagedIdentityProviderActionResult<ManagedIdentityProviderActionOutputMap[TActionId]>>;
}>;

export function createManagedIdentityProviderClient(scope: ServerAccountScope): ManagedIdentityProviderClient {
    const executeHomeAction = scopedHomeActionExecutor(scope);
    return Object.freeze({
        execute: async <TActionId extends ManagedIdentityProviderActionIdV1>(
            actionId: TActionId,
            input: ManagedIdentityProviderActionInputMap[TActionId],
            options?: Readonly<{
                signal?: AbortSignal;
                onApprovalSucceeded?: (value: ManagedIdentityProviderActionOutputMap[TActionId]) => void | Promise<void>;
                onApprovalFailed?: (code: string) => void;
            }>,
        ): Promise<ManagedIdentityProviderActionResult<ManagedIdentityProviderActionOutputMap[TActionId]>> => {
            const parsedInput = homeDomainActionInputSchemaV1(actionId).safeParse(input);
            if (!parsedInput.success) {
                return { kind: 'failed', failure: { code: 'invalid_parameters', retryable: false } };
            }
            const actionResult = await executeHomeAction(actionId, parsedInput.data, {
                surface: 'ui',
                authority: 'present_user',
                serverId: scope.serverId,
                ...(options?.signal ? { signal: options.signal } : {}),
            });
            const outcome = classifyHomeActionOutcome(actionResult);
            if (outcome.kind === 'failed') {
                const code = homeDomainFailureCode(outcome.failure);
                return {
                    kind: 'failed',
                    failure: {
                        code,
                        retryable: resolveIdentityAdministrationFailureRetryable(outcome.failure, code),
                    },
                };
            }
            if (outcome.kind === 'approval_pending') {
                // Read Actions cannot legitimately enter deferred mutation
                // approval. Fail closed rather than manufacturing a list or
                // preflight result from the approval envelope.
                if (getActionSpec(actionId).sideEffectClass === 'read') {
                    return { kind: 'failed', failure: { code: 'invalid_action_output', retryable: false } };
                }
                return {
                    ...outcome,
                    approval: createHomeActionApprovalContinuation<ManagedIdentityProviderActionOutputMap[TActionId], TActionId>({
                        artifactId: outcome.artifactId,
                        actionId,
                        scope,
                        expectedInput: parsedInput.data,
                        onSucceeded: async (value) => await options?.onApprovalSucceeded?.(value),
                        onFailed: options?.onApprovalFailed,
                    }),
                };
            }
            const parsedOutput = homeDomainActionOutputSchemaV1(actionId).safeParse(outcome.result);
            if (!parsedOutput.success) {
                return { kind: 'failed', failure: { code: 'invalid_action_output', retryable: false } };
            }
            return {
                kind: 'succeeded',
                value: parsedOutput.data as ManagedIdentityProviderActionOutputMap[TActionId],
            };
        },
    });
}
