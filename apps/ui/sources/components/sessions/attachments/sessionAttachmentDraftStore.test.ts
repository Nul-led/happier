import { beforeEach, describe, expect, it } from 'vitest';

import type { AttachmentDraft } from './attachmentDraftModel';
import {
    clearSessionAttachmentDrafts,
    readSessionAttachmentDrafts,
    writeSessionAttachmentDrafts,
} from './sessionAttachmentDraftStore';

const draft: AttachmentDraft = {
    id: 'attachment-1',
    source: {
        kind: 'memory',
        name: 'notes.txt',
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'text/plain',
    },
    status: 'pending',
};

describe('sessionAttachmentDraftStore', () => {
    beforeEach(() => {
        clearSessionAttachmentDrafts({ serverId: 'home-a', accountId: 'account-a', sessionId: 'same-session', occurrenceId: 'run-a' });
        clearSessionAttachmentDrafts({ serverId: 'home-a', accountId: 'account-b', sessionId: 'same-session', occurrenceId: 'run-a' });
        clearSessionAttachmentDrafts({ serverId: 'home-b', accountId: 'account-a', sessionId: 'same-session', occurrenceId: 'run-a' });
        clearSessionAttachmentDrafts({ serverId: 'home-a', accountId: 'account-a', sessionId: 'same-session', occurrenceId: 'run-b' });
    });

    it('retains unsent bytes across more than fifty scopes until explicitly cleared', () => {
        const scopes = Array.from({ length: 51 }, (_, index) => ({
            serverId: 'home-retention',
            accountId: 'account-a',
            sessionId: `session-${index}`,
            occurrenceId: 'run-a',
        }));
        try {
            for (const scope of scopes) writeSessionAttachmentDrafts(scope, [draft]);
            for (const scope of scopes) expect(readSessionAttachmentDrafts(scope)).toEqual([draft]);
            clearSessionAttachmentDrafts(scopes[0]!);
            expect(readSessionAttachmentDrafts(scopes[0]!)).toEqual([]);
            expect(readSessionAttachmentDrafts(scopes[1]!)).toEqual([draft]);
        } finally {
            for (const scope of scopes) clearSessionAttachmentDrafts(scope);
        }
    });

    it('keeps transfer drafts isolated by exact Home, Account, and Run/draft occurrence', () => {
        writeSessionAttachmentDrafts(
            { serverId: 'home-a', accountId: 'account-a', sessionId: 'same-session', occurrenceId: 'run-a' },
            [draft],
        );

        expect(readSessionAttachmentDrafts({
            serverId: 'home-a',
            accountId: 'account-a',
            sessionId: 'same-session',
            occurrenceId: 'run-a',
        })).toEqual([draft]);
        expect(readSessionAttachmentDrafts({
            serverId: 'home-a',
            accountId: 'account-b',
            sessionId: 'same-session',
            occurrenceId: 'run-a',
        })).toEqual([]);
        expect(readSessionAttachmentDrafts({
            serverId: 'home-b',
            accountId: 'account-a',
            sessionId: 'same-session',
            occurrenceId: 'run-a',
        })).toEqual([]);
        expect(readSessionAttachmentDrafts({
            serverId: 'home-a',
            accountId: 'account-a',
            sessionId: 'same-session',
            occurrenceId: 'run-b',
        })).toEqual([]);
    });

});
