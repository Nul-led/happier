import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    SessionDraftMutateResponseV2Schema,
    SessionDraftMutateResponseV1Schema,
    SessionDraftReadResponseV1Schema,
} from '@happier-dev/protocol';

const request = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const address = { kind: 'session', sessionId: 'session-a' } as const;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('apiSessionDrafts', () => {
    beforeEach(() => request.mockReset());

    it('posts typed read and mutate requests and validates responses', async () => {
        const { createApiSessionDraftsTransport } = await import('./apiSessionDrafts');
        const readResponse = SessionDraftReadResponseV1Schema.parse({ status: 'absent' });
        const mutateResponse = SessionDraftMutateResponseV1Schema.parse({
            status: 'conflict',
            current: { status: 'absent' },
        });
        request.mockResolvedValueOnce(jsonResponse(readResponse)).mockResolvedValueOnce(jsonResponse(mutateResponse));
        const transport = createApiSessionDraftsTransport({ request });

        await expect(transport.read(address)).resolves.toEqual(readResponse);
        await expect(transport.mutate({ address, expectedRevision: 'absent', content: null })).resolves.toEqual(mutateResponse);

        expect(request).toHaveBeenNthCalledWith(1, '/v1/account/session-drafts/read', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ address }),
            headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }));
    });

    it('rejects malformed successful responses instead of materializing unvalidated bytes', async () => {
        const { createApiSessionDraftsTransport } = await import('./apiSessionDrafts');
        request.mockResolvedValueOnce(jsonResponse({ status: 'present', record: { revision: 'wrong' } }));

        await expect(createApiSessionDraftsTransport({ request }).read(address)).rejects.toThrow('Invalid session draft response');
    });
});



describe('successor newSession content epoch', () => {
    beforeEach(() => request.mockReset());
    const newAddress = { kind: 'newSession', draftId: '10000000-0000-4000-8000-000000000001' } as const;

    it('keeps non-representable encrypted newSession content on V2 and retains intent when unavailable', async () => {
        const { createApiSessionDraftsTransport } = await import('./apiSessionDrafts');
        request.mockResolvedValueOnce(jsonResponse({}, 404));
        await expect(createApiSessionDraftsTransport({ request }).mutate({
            address: newAddress, expectedRevision: 'absent', content: { t: 'encrypted', c: 'cipher', v: 2 },
        })).rejects.toMatchObject({ code: 'session_draft_epoch_unavailable' });
        expect(request.mock.calls.map(([path]) => path)).toEqual(['/v2/account/session-drafts/mutate']);
    });

    it('falls back once through the supported predecessor V1 route for a lossless newSession projection', async () => {
        const { createApiSessionDraftsTransport } = await import('./apiSessionDrafts');
        const canonicalContent = {
            t: 'plain' as const,
            v: {
                v: 2 as const,
                address: newAddress,
                document: {
                    v: 2 as const,
                    composer: {
                        text: { mutationId: '20000000-0000-4000-8000-000000000001', value: 'keep me' },
                        mentions: { mutationId: '20000000-0000-4000-8000-000000000002', value: [] },
                        attachments: { mutationId: '20000000-0000-4000-8000-000000000003', value: [] },
                    },
                    target: {
                        kind: 'newSession' as const,
                        authoring: {
                            executionTarget: {
                                mutationId: '20000000-0000-4000-8000-000000000004',
                                value: {
                                    kind: 'machine',
                                    target: { serverId: 'home-a', machineId: 'machine-a' },
                                    selectionOrigin: { kind: 'machine_pool', poolId: '11111111-1111-4111-8111-111111111111' },
                                },
                            },
                            organizationPlacement: {
                                mutationId: '20000000-0000-4000-8000-000000000005',
                                value: { folderId: null, tagIds: ['tag-a'] },
                            },
                            runtimeDescriptorV1: {
                                mutationId: '20000000-0000-4000-8000-000000000006',
                                value: null,
                            },
                        },
                    },
                    extensions: {
                        happier: {
                            retained: { mutationId: '20000000-0000-4000-8000-000000000007', value: { future: true } },
                        },
                    },
                },
            },
        };
        const predecessorContent = {
            t: 'plain' as const,
            v: {
                ...canonicalContent.v,
                v: 1 as const,
                document: {
                    ...canonicalContent.v.document,
                    v: 1 as const,
                    target: {
                        ...canonicalContent.v.document.target,
                        authoring: {
                            ...canonicalContent.v.document.target.authoring,
                            serverId: { mutationId: '20000000-0000-4000-8000-000000000004', value: 'home-a' },
                            machineId: { mutationId: '20000000-0000-4000-8000-000000000004', value: 'machine-a' },
                        },
                    },
                },
            },
        };
        const predecessorRecord = {
            address: newAddress,
            revision: 4,
            content: predecessorContent,
            createdAt: 10,
            updatedAt: 20,
        };
        const predecessorEditedContent = {
            ...predecessorContent,
            v: {
                ...predecessorContent.v,
                document: {
                    ...predecessorContent.v.document,
                    composer: {
                        ...predecessorContent.v.document.composer,
                        text: { mutationId: '20000000-0000-4000-8000-000000000008', value: 'edited on predecessor' },
                    },
                    target: {
                        ...predecessorContent.v.document.target,
                        authoring: {
                            ...predecessorContent.v.document.target.authoring,
                            serverId: { mutationId: '20000000-0000-4000-8000-000000000009', value: 'predecessor-display-home' },
                            machineId: { mutationId: '20000000-0000-4000-8000-000000000010', value: 'predecessor-display-machine' },
                        },
                    },
                },
            },
        };
        const predecessorEditedExecutionTarget = {
            mutationId: '20000000-0000-4000-8000-000000000010',
            value: {
                kind: 'machine',
                target: { serverId: 'predecessor-display-home', machineId: 'predecessor-display-machine' },
            },
        };
        request.mockResolvedValueOnce(jsonResponse({}, 404)).mockResolvedValueOnce(jsonResponse({
            status: 'updated', record: predecessorRecord,
        })).mockResolvedValueOnce(jsonResponse({
            status: 'present', record: { ...predecessorRecord, revision: 5, content: predecessorEditedContent },
        })).mockResolvedValueOnce(jsonResponse({}, 404)).mockResolvedValueOnce(jsonResponse({
            items: [{ ...predecessorRecord, revision: 5, content: predecessorEditedContent }],
        }));

        const transport = createApiSessionDraftsTransport({ request });
        const result = await transport.mutate({
            address: newAddress,
            expectedRevision: 3,
            content: canonicalContent,
        }, { supportedPredecessorV1Content: predecessorContent });
        const reread = await transport.read(newAddress);
        const relisted = await transport.list({});

        expect(request.mock.calls.map(([path]) => path)).toEqual([
            '/v2/account/session-drafts/mutate',
            '/v1/account/session-drafts/mutate',
            '/v1/account/session-drafts/read',
            '/v2/account/session-drafts/list',
            '/v1/account/session-drafts/list',
        ]);
        expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
            address: newAddress,
            expectedRevision: 3,
            content: canonicalContent,
        });
        expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
            address: newAddress,
            expectedRevision: 3,
            content: predecessorContent,
        });
        expect(SessionDraftMutateResponseV2Schema.parse(result)).toEqual({
            status: 'updated',
            record: { ...predecessorRecord, content: canonicalContent },
        });
        expect(reread).toMatchObject({
            status: 'present',
            record: {
                revision: 5,
                content: {
                    t: 'plain',
                    v: {
                        v: 2,
                        document: {
                            v: 2,
                            composer: { text: { value: 'edited on predecessor' } },
                            target: { authoring: { executionTarget: predecessorEditedExecutionTarget } },
                            extensions: canonicalContent.v.document.extensions,
                        },
                    },
                },
            },
        });
        expect(relisted).toMatchObject({
            items: [{
                revision: 5,
                content: {
                    t: 'plain',
                    v: {
                        v: 2,
                        document: {
                            v: 2,
                            target: { authoring: { executionTarget: predecessorEditedExecutionTarget } },
                            extensions: canonicalContent.v.document.extensions,
                        },
                    },
                },
            }],
        });
    });

    it('does not duplicate a losslessly representable write on a V2-capable Home', async () => {
        const { createApiSessionDraftsTransport } = await import('./apiSessionDrafts');
        const content = { t: 'encrypted' as const, c: 'canonical-v2', v: 2 as const };
        request.mockResolvedValueOnce(jsonResponse({
            status: 'updated',
            record: { address: newAddress, revision: 1, content, createdAt: 1, updatedAt: 1 },
        }));

        await createApiSessionDraftsTransport({ request }).mutate({
            address: newAddress,
            expectedRevision: 'absent',
            content,
        }, { supportedPredecessorV1Content: { t: 'encrypted', c: 'predecessor-v1' } });

        expect(request.mock.calls.map(([path]) => path)).toEqual(['/v2/account/session-drafts/mutate']);
    });

    it('preserves CAS conflict semantics for an encrypted predecessor fallback without exposing plaintext', async () => {
        const { createApiSessionDraftsTransport } = await import('./apiSessionDrafts');
        request.mockResolvedValueOnce(jsonResponse({}, 404)).mockResolvedValueOnce(jsonResponse({
            status: 'conflict', current: { status: 'absent' },
        }));

        await expect(createApiSessionDraftsTransport({ request }).mutate({
            address: newAddress,
            expectedRevision: 7,
            content: { t: 'encrypted', c: 'canonical-v2', v: 2 },
        }, {
            supportedPredecessorV1Content: { t: 'encrypted', c: 'predecessor-v1' },
        })).resolves.toEqual({ status: 'conflict', current: { status: 'absent' } });

        expect(request.mock.calls.map(([path]) => path)).toEqual([
            '/v2/account/session-drafts/mutate', '/v1/account/session-drafts/mutate',
        ]);
        expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
            address: newAddress,
            expectedRevision: 7,
            content: { t: 'encrypted', c: 'predecessor-v1' },
        });
    });

    it('uses V2 for discovery and upgrades only a proven no-effect V1 epoch refusal', async () => {
        const { createApiSessionDraftsTransport } = await import('./apiSessionDrafts');
        request.mockResolvedValueOnce(jsonResponse({ items: [] }))
            .mockResolvedValueOnce(jsonResponse({ error: 'session_draft_epoch_unavailable' }, 409))
            .mockResolvedValueOnce(jsonResponse({ status: 'absent' }))
            .mockResolvedValueOnce(jsonResponse({ error: 'session_draft_epoch_unavailable' }, 409))
            .mockResolvedValueOnce(jsonResponse({ status: 'conflict', current: { status: 'absent' } }));
        const transport = createApiSessionDraftsTransport({ request });
        await transport.list({});
        await expect(transport.read(newAddress)).resolves.toEqual({ status: 'absent' });
        await transport.mutate({ address: newAddress, expectedRevision: 3, content: { t: 'encrypted', c: 'compatible' } });
        expect(request.mock.calls.map(([path]) => path)).toEqual([
            '/v2/account/session-drafts/list', '/v1/account/session-drafts/read', '/v2/account/session-drafts/read',
            '/v1/account/session-drafts/mutate', '/v2/account/session-drafts/mutate',
        ]);
        expect(request.mock.calls[3]?.[1]?.body).toEqual(request.mock.calls[4]?.[1]?.body);
    });

    it('falls back only for an unfiltered read-only list on a server without V2', async () => {
        const { createApiSessionDraftsTransport } = await import('./apiSessionDrafts');
        request.mockResolvedValueOnce(jsonResponse({}, 404)).mockResolvedValueOnce(jsonResponse({ items: [] }));
        await expect(createApiSessionDraftsTransport({ request }).list({})).resolves.toEqual({ items: [] });
        expect(request.mock.calls.map(([path]) => path)).toEqual(['/v2/account/session-drafts/list', '/v1/account/session-drafts/list']);
    });
});
