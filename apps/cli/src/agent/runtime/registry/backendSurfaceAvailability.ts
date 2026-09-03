import type { AgentSurfaceAvailabilityV1 } from '@happier-dev/protocol';

export async function evaluateBackendSurfaceAvailability<TRequest>(
    evaluator: (request: TRequest) => AgentSurfaceAvailabilityV1 | Promise<AgentSurfaceAvailabilityV1>,
    request: TRequest,
): Promise<AgentSurfaceAvailabilityV1> {
    try {
        return await evaluator(request);
    } catch {
        return {
            available: false,
            reasonCode: 'evaluation_error',
        };
    }
}
