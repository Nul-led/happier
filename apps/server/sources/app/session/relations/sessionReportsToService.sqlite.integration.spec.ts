import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compareSessionFollowFrontierProgressV1 } from '@happier-dev/protocol';

import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { createPresentUserSessionAccessAuthentication } from '@/app/session/access/sessionAccessAuthentication.testkit';
import { transitionSessionArchiveStateInTx } from '@/app/session/archive/transitionSessionArchiveStateInTx';
import { applySessionAccessTransitionEffectsInTx } from '@/app/session/access/sessionAccessTransitionEffects';
import { resolveEffectiveSessionAccess } from '@/app/session/access/sessionAccess';
import { removeUnsafeSessionReportsToEdgesForAccessChangeInTx, setSessionReportsTo, attachCreatedSessionReportsToInTx } from './sessionReportsToService';

const authentication = createPresentUserSessionAccessAuthentication({ env: {} });
const account = () => db.account.create({ data: { publicKey: `reports-${randomUUID()}`, encryptionMode: 'plain' } });
const session = (accountId: string, facts = {}) => db.session.create({ data: {
    accountId, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain', ...facts,
} });
const set = (accountId: string, sessionId: string, leadSessionId: string | null, expectedLeadSessionId: string | null = null) =>
    setSessionReportsTo({ accountId, sessionId, leadSessionId, expectedLeadSessionId, authentication });

describe('SessionReportsTo service (SQLite integration)', () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => { harness = await createLightSqliteHarness({ tempDirPrefix: 'happier-reports-to-' }); }, 180_000);
    afterAll(async () => { if (harness) await harness.close(); });
    afterEach(async () => {
        await db.session.deleteMany();
        await db.account.deleteMany();
        await db.homeSettings.deleteMany();
    });

    it('attaches, reparents and detaches with a state CAS and idempotent same-parent retry', async () => {
        const owner = await account();
        const [child, first, second] = await Promise.all([session(owner.id), session(owner.id), session(owner.id)]);
        expect(await set(owner.id, child.id, first.id)).toMatchObject({ ok: true, leadSessionId: first.id });
        const initial = await db.sessionReportsTo.findUniqueOrThrow({ where: { sessionId: child.id } });
        expect(await set(owner.id, child.id, first.id, first.id)).toMatchObject({ ok: true, attachedAt: initial.attachedAt.getTime() });
        expect(await set(owner.id, child.id, second.id)).toEqual({ ok: false, error: 'reports_to_cas_conflict' });
        expect(await set(owner.id, child.id, second.id, first.id)).toMatchObject({ ok: true, leadSessionId: second.id });
        expect(await set(owner.id, child.id, null, first.id)).toEqual({ ok: false, error: 'reports_to_cas_conflict' });
        expect(await set(owner.id, child.id, null, second.id)).toMatchObject({ ok: true, leadSessionId: null, attachedAt: null });
        expect(await db.sessionReportsTo.count()).toBe(0);
    });

    it('rejects self and ancestor cycles without changing the existing tree', async () => {
        const owner = await account();
        const [root, middle, leaf] = await Promise.all([session(owner.id), session(owner.id), session(owner.id)]);
        expect(await set(owner.id, root.id, root.id)).toEqual({ ok: false, error: 'reports_to_cycle' });
        expect((await set(owner.id, middle.id, root.id)).ok).toBe(true);
        expect((await set(owner.id, leaf.id, middle.id)).ok).toBe(true);
        expect(await set(owner.id, root.id, leaf.id)).toEqual({ ok: false, error: 'reports_to_cycle' });
        expect(await db.sessionReportsTo.count()).toBe(2);
    });

    it('separates A-to-B-to-A and detach-to-A attachments even within one clock tick', async () => {
        const owner = await account();
        const [child, first, second] = await Promise.all([session(owner.id), session(owner.id), session(owner.id)]);
        // Clock is a genuine system boundary; all relation and persistence logic stays real.
        const clock = vi.spyOn(Date, 'now').mockReturnValue(child.updatedAt.getTime());
        try {
            const initial = await set(owner.id, child.id, first.id);
            const moved = await set(owner.id, child.id, second.id, first.id);
            const returned = await set(owner.id, child.id, first.id, second.id);
            await set(owner.id, child.id, null, first.id);
            const reattached = await set(owner.id, child.id, first.id);
            if (!initial.ok || !moved.ok || !returned.ok || !reattached.ok) throw new Error('Attachment fixture was refused');
            expect(initial.attachedAt).not.toBeNull();
            expect(moved.attachedAt!).toBeGreaterThan(initial.attachedAt!);
            expect(returned.attachedAt!).toBeGreaterThan(moved.attachedAt!);
            expect(reattached.attachedAt!).toBeGreaterThan(returned.attachedAt!);
        } finally { clock.mockRestore(); }
    });

    it('requires active acting Account and read/input on both sides before the pairwise audience check', async () => {
        const [owner, actor] = await Promise.all([account(), account()]);
        const [child, lead] = await Promise.all([session(owner.id), session(owner.id)]);
        expect(await set(actor.id, child.id, lead.id)).toEqual({ ok: false, error: 'reports_to_forbidden', reason: 'read' });
        for (const target of [child, lead]) await db.sessionShare.create({ data: {
            sessionId: target.id, sharedByUserId: owner.id, sharedWithUserId: actor.id, accessLevel: 'view',
        } });
        expect(await set(actor.id, child.id, lead.id)).toEqual({ ok: false, error: 'reports_to_forbidden', reason: 'input' });
        await db.sessionShare.updateMany({ data: { accessLevel: 'edit' } });
        await db.account.update({ where: { id: actor.id }, data: { status: 'disabled' } });
        expect(await set(actor.id, child.id, lead.id)).toEqual({ ok: false, error: 'reports_to_forbidden', reason: 'read' });
        expect(await db.sessionReportsTo.count()).toBe(0);
    });

    it('permits a cross-owner pair only when the whole lead audience can read the child', async () => {
        const [workerOwner, leadOwner, other] = await Promise.all([account(), account(), account()]);
        const child = await session(workerOwner.id);
        const lead = await session(leadOwner.id);
        await db.sessionShare.create({ data: { sessionId: lead.id, sharedByUserId: leadOwner.id, sharedWithUserId: workerOwner.id, accessLevel: 'edit' } });
        expect(await set(workerOwner.id, child.id, lead.id)).toEqual({ ok: false, error: 'reports_to_forbidden', reason: 'pairwise' });
        await db.sessionShare.create({ data: { sessionId: child.id, sharedByUserId: workerOwner.id, sharedWithUserId: leadOwner.id, accessLevel: 'edit' } });
        expect((await set(workerOwner.id, child.id, lead.id)).ok).toBe(true);
        expect(await inTx((tx) => removeUnsafeSessionReportsToEdgesForAccessChangeInTx(tx, { sessionId: lead.id }))).toBe(0);
        await inTx(async (tx) => {
            const before = await resolveEffectiveSessionAccess(tx, { accountId: other.id, sessionId: lead.id, authentication });
            await tx.sessionShare.create({ data: { sessionId: lead.id, sharedByUserId: leadOwner.id, sharedWithUserId: other.id, accessLevel: 'view' } });
            const after = await resolveEffectiveSessionAccess(tx, { accountId: other.id, sessionId: lead.id, authentication });
            await applySessionAccessTransitionEffectsInTx(tx, {
                sessionId: lead.id, before: new Map([[other.id, before]]), after: new Map([[other.id, after]]),
            });
        });
        expect(await db.sessionReportsTo.count()).toBe(0);
    });

    it('seeds before current terminal state, retries without reseeding delivered state, and reseeds on restore', async () => {
        const owner = await account();
        const child = await session(owner.id, { seq: 10, latestReadyEventSeq: 3, agentStateVersion: 4, latestTurnId: 'turn-terminal', latestTurnStatus: 'completed' });
        const lead = await session(owner.id);
        expect((await set(owner.id, child.id, lead.id)).ok).toBe(true);
        const edge = await db.sessionReportsTo.findUniqueOrThrow({ where: { sessionId: child.id } });
        // The stored frontier leaves current terminal facts pending, without replaying prior transcript.
        expect(edge.deliveredTranscriptSeq).toBe(10);
        expect(edge.deliveredTurnId).toBeNull();
        expect(compareSessionFollowFrontierProgressV1({ transcriptSeq: edge.deliveredTranscriptSeq, readyEventSeq: edge.deliveredReadyEventSeq,
            agentStateVersion: edge.deliveredAgentStateVersion, turn: null },
        { transcriptSeq: 10, readyEventSeq: 3, agentStateVersion: 4, turn: { id: 'turn-terminal', status: 'completed' } })).toBe('ahead');
        await db.sessionReportsTo.update({ where: { sessionId: child.id }, data: {
            deliveredReadyEventSeq: 3, deliveredAgentStateVersion: 4, deliveredTurnId: 'turn-terminal', deliveredTurnStatus: 'completed',
        } });
        await set(owner.id, child.id, lead.id, lead.id);
        expect((await db.sessionReportsTo.findUniqueOrThrow({ where: { sessionId: child.id } })).deliveredTurnId).toBe('turn-terminal');
        await inTx((tx) => transitionSessionArchiveStateInTx({ tx, sessionId: lead.id, wasArchived: false, archivedAt: new Date() }));
        expect(await db.sessionReportsTo.count()).toBe(1);
        expect((await db.session.findUniqueOrThrow({ where: { id: child.id } })).archivedAt).toBeNull();
        await inTx((tx) => transitionSessionArchiveStateInTx({ tx, sessionId: lead.id, wasArchived: true, archivedAt: null }));
        expect((await db.sessionReportsTo.findUniqueOrThrow({ where: { sessionId: child.id } })).deliveredTurnId).toBeNull();
    });

    it('allows attach to an archived session and retains its relation for restore', async () => {
        const owner = await account();
        const child = await session(owner.id);
        const lead = await session(owner.id, { archivedAt: new Date() });
        expect((await set(owner.id, child.id, lead.id)).ok).toBe(true);
        expect(await db.sessionReportsTo.count()).toBe(1);
    });

    it('attaches a fresh child inside its creation transaction without allocating the Home fence', async () => {
        const owner = await account();
        const lead = await session(owner.id);
        const childId = await inTx(async (tx) => {
            const child = await tx.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain' } });
            const result = await attachCreatedSessionReportsToInTx(tx, { accountId: owner.id, sessionId: child.id, leadSessionId: lead.id, authentication });
            expect(result.ok).toBe(true);
            return child.id;
        });
        expect(await db.sessionReportsTo.findUnique({ where: { sessionId: childId } })).not.toBeNull();
        expect(await db.homeSettings.count()).toBe(0);
    });
});
