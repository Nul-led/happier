import { describe, expect, it } from 'vitest';

import { clearSessionTranscriptDerivedCachesForSession } from '@/sync/runtime/sessionTranscriptDerivedCaches';
import { readTranscriptDerivedItemsCacheEntry, writeTranscriptDerivedItemsCacheEntry } from './derivedItemsCache';

describe('transcript derived items lifetime', () => {
    it('releases only the retired session through the transcript release owner', () => {
        const turnsCache = {
            messageIdsOldestFirst: ['message'], messageGroupingKeysOldestFirst: ['user'],
            groupToolCalls: false, toolCallsGroupStrategy: 'consecutive_tools' as const,
            turns: [{ id: 'turn', userMessageId: 'message', content: [] }],
            lastTurnState: { kind: 'none' as const },
        };
        writeTranscriptDerivedItemsCacheEntry('released', 16, { turnsCache });
        writeTranscriptDerivedItemsCacheEntry('retained', 16, { turnsCache });
        const retained = readTranscriptDerivedItemsCacheEntry('retained', 16);

        clearSessionTranscriptDerivedCachesForSession('released');
        clearSessionTranscriptDerivedCachesForSession('released');

        expect(readTranscriptDerivedItemsCacheEntry('released', 16)).toEqual({ linearItemsCache: null, turnsCache: null });
        expect(readTranscriptDerivedItemsCacheEntry('retained', 16)).toBe(retained);
        clearSessionTranscriptDerivedCachesForSession('retained');
    });
});
