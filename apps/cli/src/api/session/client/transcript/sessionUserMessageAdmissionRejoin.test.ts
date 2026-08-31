import { describe, expect, it, vi } from 'vitest';

import { findPersistedSessionUserMessageAdmission } from './sessionUserMessageAdmissionRejoin';

const ATTACHMENT = {
    v: 1 as const,
    instanceId: 'issue-instance-1',
    attachment: { pluginId: 'acme.issues', localId: 'issue' },
    key: 'issue-42',
    value: { issueId: '42', prepared: true },
    presentation: { label: 'Issue #42', typeLabel: 'Contexte du problème' },
};

function storedContent(text = 'prepared text') {
    return {
        t: 'plain' as const,
        v: {
            role: 'user',
            content: { type: 'text', text },
            meta: {
                source: 'ui',
                sentFrom: 'ui',
                happierStructuredInputV1: { v: 1, composerAttachments: [ATTACHMENT] },
            },
        },
    };
}

describe('persisted Session user-message admission rejoin', () => {
    it('recovers the already prepared text and attachments from pending custody without a plugin read', async () => {
        const readPending = vi.fn(async () => storedContent());
        const findTranscript = vi.fn(async () => ({ type: 'not_found' as const }));

        await expect(findPersistedSessionUserMessageAdmission({
            token: 'token',
            sessionId: 'session-1',
            localId: 'message-1',
            queryContext: { encryptionMode: 'plain' },
        }, { readPending, findTranscript })).resolves.toEqual({
            text: 'prepared text',
            meta: {
                source: 'ui',
                sentFrom: 'ui',
                happierStructuredInputV1: { v: 1, composerAttachments: [ATTACHMENT] },
            },
            composerAttachments: [ATTACHMENT],
        });
    });

    it('uses committed custody after pending materialization and fails closed on an encryption-mode mismatch', async () => {
        const findTranscript = vi.fn(async () => ({
            type: 'found' as const,
            message: {
                id: 'server-message-1',
                seq: 1,
                localId: 'message-1',
                sidechainId: null,
                createdAt: 1,
                updatedAt: 1,
                content: storedContent('committed text'),
            },
        }));
        const input = {
            token: 'token',
            sessionId: 'session-1',
            localId: 'message-1',
            queryContext: { encryptionMode: 'plain' as const },
        };

        await expect(findPersistedSessionUserMessageAdmission(input, {
            readPending: async () => null,
            findTranscript,
        })).resolves.toMatchObject({ text: 'committed text', composerAttachments: [ATTACHMENT] });

        await expect(findPersistedSessionUserMessageAdmission({
            ...input,
            queryContext: {
                encryptionMode: 'e2ee' as const,
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'legacy' as const,
            },
        }, {
            readPending: async () => storedContent(),
            findTranscript: async () => ({ type: 'not_found' as const }),
        })).rejects.toThrow('encryption mode');
    });
});
