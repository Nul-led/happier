import { readSessionBoardFeatureEnv } from './catalog/readFeatureEnv';
import { isSessionSystemRecordsProtocolV1Active } from '@/app/session/systemRecords/sessionSystemRecordProtocolContract';
import type { FeaturesPayloadDelta } from './types';

export function resolveSessionBoardFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    return { features: { sessions: { enabled: true, board: {
        enabled: readSessionBoardFeatureEnv(env).enabled && isSessionSystemRecordsProtocolV1Active(),
    } } } };
}
