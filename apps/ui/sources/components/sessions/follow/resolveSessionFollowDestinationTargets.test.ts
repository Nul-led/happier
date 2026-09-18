import { describe, expect, it } from 'vitest';

import { createSessionAccessFixture } from '@/dev/testkit/fixtures/sessionFixtures';

import {
    resolveSessionFollowDestinationTargets,
    resolveSessionFollowSourceTargets,
    type SessionFollowDestinationTargetCandidate,
} from './resolveSessionFollowDestinationTargets';

function candidate(
    input: Partial<SessionFollowDestinationTargetCandidate> & Pick<SessionFollowDestinationTargetCandidate, 'id'>,
): SessionFollowDestinationTargetCandidate {
    return {
        id: input.id,
        serverId: input.serverId ?? 'home-a',
        access: input.access === undefined ? createSessionAccessFixture('edit') : input.access,
        metadata: input.metadata ?? {},
        meaningfulActivityAt: input.meaningfulActivityAt ?? null,
        updatedAt: input.updatedAt ?? 0,
        createdAt: input.createdAt ?? 0,
    };
}

describe('resolveSessionFollowDestinationTargets', () => {
    it('keeps only accessible same-Home destinations and excludes the source Session', () => {
        const targets = resolveSessionFollowDestinationTargets({
            source: { serverId: 'home-a', sessionId: 'source' },
            sessions: [
                candidate({ id: 'source' }),
                candidate({ id: 'destination', updatedAt: 40 }),
                candidate({ id: 'read-only', access: createSessionAccessFixture('view'), updatedAt: 30 }),
                candidate({ id: 'inaccessible', access: null, updatedAt: 20 }),
                candidate({ id: 'other-home', serverId: 'home-b', updatedAt: 10 }),
                candidate({ id: 'hidden', metadata: { hiddenSystemSession: true }, updatedAt: 50 }),
            ],
        });

        expect(targets.map((target) => target.id)).toEqual(['destination']);
    });

    it('uses the same qualified access boundary when choosing a source for a fixed destination', () => {
        const targets = resolveSessionFollowSourceTargets({
            destination: { serverId: 'home-a', sessionId: 'destination' },
            sessions: [
                candidate({ id: 'destination' }),
                candidate({ id: 'source', access: createSessionAccessFixture('view'), updatedAt: 40 }),
                candidate({ id: 'inaccessible', access: null, updatedAt: 20 }),
                candidate({ id: 'other-home', serverId: 'home-b', updatedAt: 10 }),
                candidate({ id: 'hidden', metadata: { hiddenSystemSession: true }, updatedAt: 50 }),
            ],
        });

        expect(targets.map((target) => target.id)).toEqual(['source']);
    });
});
