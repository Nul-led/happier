import { describe, expect, it } from 'vitest';
import { createSessionAccessFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';

describe('access projection through synchronized Session rows', () => {
    it('recognizes Team-only list recipients without legacy accessLevel', () => {
        expect(isUserFacingSession({ metadataLayoutVersion: 1, metadata: { v: 1, summary: { text: 'Shared', updatedAt: 1 } }, ownerMetadataView: null, access: createSessionAccessFixture('view') })).toBe(true);
    });
});
