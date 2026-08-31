import { MemorySearchQueryV1Schema, MemorySearchResultV1Schema, type MemorySearchQueryV1, type MemorySearchResultV1 } from '@happier-dev/protocol';
import type { Fastify } from '@/app/api/types';
import { resolveApiHotEndpointRateLimit } from '@/app/api/utils/apiRateLimitCatalog';
import { requirePresentUser } from '@/app/api/utils/requirePresentUser';
import type { HomeSearchCapability } from './homeSearchCapability';

/** Registers the single authenticated Personal Home search operation. */
export function registerHomeSearchRoutes(app: Fastify, params: Readonly<{
    service: Readonly<{ capability(): HomeSearchCapability; search(query: MemorySearchQueryV1, context?: Readonly<{ visibleSessionIds?: readonly string[] }>): MemorySearchResultV1 }>;
    resolveVisibleSessionIds: (userId: string) => Promise<readonly string[]>;
}>): void {
    app.post('/v1/home/search', {
        schema: {
            body: MemorySearchQueryV1Schema,
            response: { 200: MemorySearchResultV1Schema },
        },
        preHandler: [app.authenticate, requirePresentUser],
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, 'session.messages') },
    }, async (request, reply) => reply.send(params.service.search(request.body, {
        visibleSessionIds: await params.resolveVisibleSessionIds(request.userId),
    })));
}
