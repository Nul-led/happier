import axios, { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeBase64, encrypt } from '@/api/encryption';
import type { SessionMessageContent } from '@/api/types';
import { findPersistedSessionUserMessageAdmission } from './sessionUserMessageAdmissionRejoin';

const ATTACHMENT = {
    v: 1 as const,
    instanceId: 'issue-instance-1',
    attachment: { pluginId: 'acme.issues', localId: 'issue' },
    key: 'issue-42',
    value: { issueId: '42', prepared: true },
    presentation: { label: 'Issue #42', typeLabel: 'Contexte du problème' },
};
const payload = {
    role: 'user',
    content: { type: 'text', text: 'prepared text' },
    meta: {
        source: 'ui', sentFrom: 'ui',
        happierStructuredInputV1: { v: 1, composerAttachments: [ATTACHMENT] },
    },
};

function serveCustody(pending: SessionMessageContent | null, committed: SessionMessageContent | null) {
    // HTTP is the only substituted boundary; both durable custody readers and crypto run normally.
    vi.spyOn(axios, 'get').mockImplementation(async (url) => {
        if (String(url).endsWith('/pending')) {
            return { status: 200, data: { pending: pending ? [{ localId: 'message-1', content: pending }] : [] } };
        }
        if (!committed) {
            throw new AxiosError('Not found', 'ERR_BAD_REQUEST', undefined, undefined,
                { status: 404, data: { error: 'Message not found' } } as AxiosResponse);
        }
        return { status: 200, data: { message: {
            id: 'server-message-1', seq: 1, localId: 'message-1',
            createdAt: 1, updatedAt: 1, content: committed,
        } } };
    });
}

describe('persisted Session user-message admission rejoin', () => {
    afterEach(() => vi.restoreAllMocks());

    it.each(['pending', 'committed'] as const)('recovers prepared plaintext from %s custody', async (custody) => {
        const content = { t: 'plain', v: payload } as const;
        serveCustody(custody === 'pending' ? content : null, custody === 'committed' ? content : null);
        await expect(findPersistedSessionUserMessageAdmission({
            token: 'token', sessionId: 'session-1', localId: 'message-1',
            queryContext: { encryptionMode: 'plain' },
        })).resolves.toEqual({ text: 'prepared text', meta: payload.meta, composerAttachments: [ATTACHMENT] });
    });

    it('opens matching encrypted pending and committed custody without repeating preparation', async () => {
        const encryptionKey = new Uint8Array(32).fill(2);
        const content = { t: 'encrypted', c: encodeBase64(encrypt(encryptionKey, 'dataKey', payload)) } as const;
        serveCustody(content, content);
        await expect(findPersistedSessionUserMessageAdmission({
            token: 'token', sessionId: 'session-1', localId: 'message-1',
            queryContext: { encryptionMode: 'e2ee', encryptionKey, encryptionVariant: 'dataKey' },
        })).resolves.toEqual({ text: 'prepared text', meta: payload.meta, composerAttachments: [ATTACHMENT] });
    });

    it('surfaces a typed mismatch from real pending and transcript readers', async () => {
        serveCustody({ t: 'plain', v: payload }, { t: 'plain', v: payload });
        await expect(findPersistedSessionUserMessageAdmission({
            token: 'token', sessionId: 'session-1', localId: 'message-1',
            queryContext: { encryptionMode: 'e2ee', encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy' },
        })).rejects.toMatchObject({ code: 'session_content_mode_mismatch' });
    });
});
