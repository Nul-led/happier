import { describe, expect, it } from 'vitest';
import { createSessionAccessFixture, createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { areStoredSessionsEqual } from '@/sync/store/domains/areStoredSessionsEqual';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { buildUpdatedSessionProjectionFromSocketUpdate, buildUpdatedSessionListRenderablePatchFromSocketUpdate } from './syncSessions';

describe('access projection through synchronized Session rows', () => {
    it('applies Team access revocation and drops owner-private projection without a tuple revision', async () => {
        const session = createSessionFixture({ metadataLayoutVersion: 1, ownerMetadataView: createSessionFixture().metadata });
        const access = createSessionAccessFixture('view');
        const effectiveAccess = { v: 1, level: access.level, sources: [{ kind: 'team', teamId: 'team-1', requiredByTeamPolicy: false }], capabilities: access.capabilities };
        const next = buildUpdatedSessionProjectionFromSocketUpdate({ session, updateBody: { effectiveAccess }, updateSeq: session.seq, updateCreatedAt: session.updatedAt });
        expect(next.access).toMatchObject(access);
        expect(next.access?.sources).toEqual(effectiveAccess.sources);
        expect(next.ownerMetadataView).toBeNull();
        expect(areStoredSessionsEqual(session, { ...session, access: next.access, ownerMetadataView: null })).toBe(false);
        const renderable = buildSessionListRenderableFromSession(session);
        const patch = await buildUpdatedSessionListRenderablePatchFromSocketUpdate({ renderable, updateBody: { effectiveAccess }, updateSeq: session.seq, updateCreatedAt: session.updatedAt, sessionEncryption: null });
        expect(patch.access).toMatchObject(access);
        expect(patch.access?.sources).toEqual(effectiveAccess.sources);
    });

    it('recognizes Team-only list recipients without legacy accessLevel', () => {
        expect(isUserFacingSession({ metadataLayoutVersion: 1, metadata: { v: 1, summary: { text: 'Shared', updatedAt: 1 } }, ownerMetadataView: null, access: createSessionAccessFixture('view') })).toBe(true);
    });

    it('fails closed instead of retaining owner authority when a supplied current access projection is malformed', async () => {
        const session = createSessionFixture({
            metadataLayoutVersion: 1,
            ownerMetadataView: createSessionFixture().metadata,
        });
        const updateBody = { effectiveAccess: { v: 1, level: 'view' } };

        const next = buildUpdatedSessionProjectionFromSocketUpdate({
            session,
            updateBody,
            updateSeq: session.seq,
            updateCreatedAt: session.updatedAt,
        });
        expect(next.access).toBeNull();
        expect(next.ownerMetadataView).toBeNull();

        const patch = await buildUpdatedSessionListRenderablePatchFromSocketUpdate({
            renderable: buildSessionListRenderableFromSession(session),
            updateBody,
            updateSeq: session.seq,
            updateCreatedAt: session.updatedAt,
            sessionEncryption: null,
        });
        expect(patch.access).toBeNull();
    });
});
