import type { ScmCapabilities, ScmCommitCreateRequest, ScmRemotePolicy } from '@happier-dev/protocol/scm';
import { admitScmCommitPolicy, admitScmRemotePolicy, ScmBackendDescribeResponseSchema } from '@happier-dev/protocol/scm';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { assertScmResponse } from './scmRpcFailure';

type ScmRpcPolicyRequest = Pick<ScmCommitCreateRequest, 'mode' | 'signOff'> & ScmRemotePolicy & Readonly<{ cwd?: string; backendPreference?: unknown }>;

export async function runScmRpcWithAdmission<T extends { success: boolean; error?: string; errorCode?: string }>(input: Readonly<{
    method: string;
    request: ScmRpcPolicyRequest;
    call: (method: string, request: Readonly<object>) => Promise<unknown>;
}>): Promise<T> {
    const commitAdmission = admitScmCommitPolicy(input.request);
    const remoteAdmission = admitScmRemotePolicy(input.request);
    if (!commitAdmission.success || !remoteAdmission.success) {
        let capabilities: ScmCapabilities | undefined;
        try {
            const description = ScmBackendDescribeResponseSchema.safeParse(await input.call(RPC_METHODS.SCM_BACKEND_DESCRIBE, {
                ...(input.request.cwd === undefined ? {} : { cwd: input.request.cwd }),
                ...(input.request.backendPreference === undefined ? {} : { backendPreference: input.request.backendPreference }),
            })).data;
            capabilities = description?.success ? description.capabilities : undefined;
        } catch {
            // This is a read-only preflight. No advanced write has been dispatched.
        }
        const verifiedCommit = admitScmCommitPolicy(input.request, capabilities);
        if (!verifiedCommit.success) return verifiedCommit as T;
        const verifiedRemote = admitScmRemotePolicy(input.request, capabilities);
        if (!verifiedRemote.success) return verifiedRemote as T;
    }
    const response = await input.call(input.method, input.request);
    return assertScmResponse<T>(response);
}
