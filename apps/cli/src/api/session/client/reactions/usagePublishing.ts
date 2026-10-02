import { serializeAxiosErrorForLog } from '@/api/client/serializeAxiosErrorForLog';
import { logger } from '@/ui/logger';
import type { UsageObservationPublishResult } from '@/usage/createUsageObservationPublisher';
import {
    extractUsageObservationFromTokenCountMessage,
    type UsageObservation,
} from '@/usage/usageObservation';

export type SessionUsageObservationPublisher = Readonly<{
    publish: (params: Readonly<{
        sessionId: string;
        observation: UsageObservation;
        backendMode?: string | null;
        externalKey?: string | null;
    }>) => Promise<void | UsageObservationPublishResult>;
}>;

export async function publishTokenCountUsageObservation(params: Readonly<{
    sessionId: string;
    publisher: SessionUsageObservationPublisher;
    provider: string;
    body: unknown;
    backendMode?: string | null;
    externalKey?: string | null;
}>): Promise<void> {
    try {
        const observation = extractUsageObservationFromTokenCountMessage({
            provider: params.provider,
            body: params.body,
        });
        if (!observation) {
            return;
        }
        await params.publisher.publish({
            sessionId: params.sessionId,
            observation,
            backendMode: params.backendMode ?? null,
            externalKey: params.externalKey ?? null,
        });
    } catch (error) {
        logger.warn('[SOCKET] Failed to publish token_count usage observation (non-fatal)', serializeAxiosErrorForLog(error));
    }
}
