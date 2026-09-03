import { describe, expect, it } from 'vitest';

import { hasPendingArchivedTranscriptMatch } from './archivedTranscriptMatchState';

describe('hasPendingArchivedTranscriptMatch', () => {
    it('settles when the only authorized transcript hit is a known active session outside this view', () => {
        expect(hasPendingArchivedTranscriptMatch({
            targetKeys: ['server:active'],
            knownSessionKeys: new Set(['server:active']),
            eligibleSessionKeys: new Set(),
            renderedSessionKeys: new Set(),
        })).toBe(false);
    });

    it('keeps an eligible archived hit pending until its row is rendered', () => {
        expect(hasPendingArchivedTranscriptMatch({
            targetKeys: ['server:archived'],
            knownSessionKeys: new Set(['server:archived']),
            eligibleSessionKeys: new Set(['server:archived']),
            renderedSessionKeys: new Set(),
        })).toBe(true);
    });
});
