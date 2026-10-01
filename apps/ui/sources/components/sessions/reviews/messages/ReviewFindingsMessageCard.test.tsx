import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewCommentV1 } from '@happier-dev/protocol';
import { REVIEW_FINDINGS_VERIFY_AND_FIX_INSTRUCTIONS_V1 } from '@happier-dev/protocol';

import { changeTextTestInstance, renderScreen } from '@/dev/testkit';
import { installSessionMessageCardCommonModuleMocks } from '@/components/sessions/sessionMessageCardTestHelpers';
import { buildReviewCommentFixture, storePlainReviewCommentFixture } from '@/dev/testkit/fixtures/reviewComments';
import { renderWithSessionTranscriptSource } from '@/dev/testkit/sessionTranscriptSource';
import { serveActionHomes, type ServedHomeRequest } from '@/dev/testkit/harness/actionHomesHttpHarness';
import { invalidateAccountEncryptionModeCache } from '@/sync/api/account/apiAccountEncryptionMode';
import { resetReviewRunCommentsForTests } from '@/sync/domains/reviews/comments/reviewRunComments';
import { retireActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { resetSessionDraftRepositoryForTests } from '@/sync/ops/sessionDrafts/sessionDraftRepository';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// System boundaries only: the session RPCs (review.follow_up, the run list/get a reviewer group is
// read from), the message send, HTTP and stored credentials (one served Home). The Action front
// door, the Home's account context, the comment store, the decision→transition mapping, effective
// findings, the reviewer merge, the one composer (`AgentInput`) with its follow-up adapter and the
// card itself run for real.
const sessionExecutionRunActionSpy = vi.fn(async (..._args: any[]): Promise<any> => ({ ok: true }));
const sessionExecutionRunListSpy = vi.fn(async (..._args: any[]): Promise<any> => ({ runs: [] }));
const sessionExecutionRunGetSpy = vi.fn(async (..._args: any[]): Promise<any> => ({ ok: false, error: 'not found' }));
const submitMessageSpy = vi.fn(async (..._args: any[]) => undefined);
const useSessionMessagesSpy = vi.fn<(...args: any[]) => any>((..._args: any[]) => ({ messages: [], isLoaded: true }));
const homeRoute = vi.hoisted(() => ({ current: null as null | ((request: any) => Response | undefined) }));
const home = vi.hoisted(() => ({ serverId: '', otherServerId: '' }));

installSessionMessageCardCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string, params?: Record<string, unknown>) => {
                switch (key) {
                    case 'runPage.review.findingTotal': return `${String(params?.count)} findings`;
                    case 'runPage.review.highCount': return `${String(params?.count)} high`;
                    case 'runPage.review.moreFindings': return `${String(params?.count)} more findings`;
                    case 'runPage.review.replies': return `${String(params?.count)} replies`;
                    case 'runPage.review.implementFixes': return `Implement ${String(params?.count ?? 0)} fixes`;
                    case 'runPage.review.followUpUnavailable.notResumable': return 'This review ended; follow-ups need a review that stays open.';
                    default: return params ? `${key}:${JSON.stringify(params)}` : key;
                }
            },
        });
    },
    uiText: async () => ({
        Text: (props: Record<string, unknown> & { children?: React.ReactNode }) => React.createElement('Text', props, props.children),
        TextInput: (props: Record<string, unknown> & { children?: React.ReactNode }) => React.createElement('TextInput', props, props.children),
    }),
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return await createStorageModuleMock({
            importOriginal: importOriginal as never,
            overrides: { useSessionMessages: (...args: any[]) => useSessionMessagesSpy(...args) },
        });
    },
});

vi.mock('@/components/markdown/MarkdownView', () => ({
    MarkdownView: (props: any) => React.createElement('MarkdownView', props),
}));
vi.mock('@/sync/ops/sessionExecutionRuns', () => ({
    sessionExecutionRunAction: (...args: any[]) => sessionExecutionRunActionSpy(...args),
    sessionExecutionRunList: (...args: any[]) => sessionExecutionRunListSpy(...args),
    sessionExecutionRunGet: (...args: any[]) => sessionExecutionRunGetSpy(...args),
}));
vi.mock('expo-image', () => ({ Image: (props: any) => React.createElement('Image', props, null) }));
// Device-local IndexedDB is a system boundary; the draft repository/owner remain real.
vi.mock('@/sync/domains/state/browserRecordStorage', async () => {
    const { createBrowserRecordStorageModuleMock } = await import('@/dev/testkit/mocks/browserRecordStorage');
    return createBrowserRecordStorageModuleMock();
});
vi.mock('@/sync/sync', () => ({
    sync: { submitMessage: (...args: any[]) => submitMessageSpy(...args) },
}));

const WORKSPACE = { machineId: 'machine-1', path: '/repo' };

function finding(id: string, severity: string, extra: Record<string, unknown> = {}) {
    return { id, title: `Title ${id}`, severity, category: 'correctness', summary: `Summary ${id}`, filePath: `${id}.ts`, startLine: 3, ...extra };
}

function payloadFor(findings: readonly Record<string, unknown>[], runRef: Record<string, unknown> = {}): any {
    return {
        runRef: { runId: 'run_1', callId: 'call_1', backendId: 'claude', retentionPolicy: 'resumable', ...runRef },
        summary: 'One real bug.',
        overviewMarkdown: 'One real bug.',
        generatedAtMs: 1,
        findings,
        questions: [],
        assumptions: [],
    };
}

function commentFor(findingId: string, overrides: Partial<ReviewCommentV1> = {}): ReviewCommentV1 {
    // The shared fixture copies only its own fields, so the review-run fields are laid over it.
    const state = overrides.state ?? 'proposed';
    return {
        ...buildReviewCommentFixture({ id: `comment-${findingId}`, sessionId: 'sess_1', runId: 'run_1', state, serverRevision: 3 }),
        workspace: WORKSPACE,
        findingId,
        ...overrides,
    };
}

/**
 * The review's Home: lists the given comments and applies transitions under CAS. `onList` can change
 * what the next list returns (another surface deciding meanwhile).
 */
function serveComments(initial: readonly ReviewCommentV1[], onList?: (listCount: number, comments: Map<string, ReviewCommentV1>) => void,
    onGet?: (getCount: number, comments: Map<string, ReviewCommentV1>) => void) {
    const comments = new Map(initial.map((comment) => [comment.id, comment]));
    const transitions: Array<Record<string, unknown>> = [];
    let listCount = 0;
    let getCount = 0;
    homeRoute.current = (request: ServedHomeRequest) => {
        if (request.path === '/v1/reviews/comments' && request.method === 'GET') {
            listCount += 1;
            onList?.(listCount, comments);
            return Response.json({ items: [...comments.values()].filter((comment) => comment.runId === request.url.searchParams.get('runId')).map(storePlainReviewCommentFixture), cursor: null });
        }
        const get = /^\/v1\/reviews\/comments\/([^/]+)$/.exec(request.path);
        if (get && request.method === 'GET') {
            onGet?.(++getCount, comments);
            const comment = comments.get(decodeURIComponent(get[1]!));
            return comment ? Response.json({ comment: storePlainReviewCommentFixture(comment) })
                : Response.json({ error: 'review_comment_not_found' }, { status: 404 });
        }
        const match = /^\/v1\/reviews\/comments\/([^/]+)\/transition$/.exec(request.path);
        if (!match) return undefined;
        const body = request.body as Record<string, unknown>;
        const commentId = decodeURIComponent(match[1]!);
        transitions.push({ commentId, ...body });
        const current = comments.get(commentId)!;
        if (body.expectedServerRevision !== current.serverRevision) {
            return Response.json({ error: 'review_comment_conflict' }, { status: 409 });
        }
        const next = {
            ...current,
            state: body.toState as ReviewCommentV1['state'],
            reviewTriageStatus: body.reviewTriageStatus as ReviewCommentV1['reviewTriageStatus'],
            serverRevision: current.serverRevision + 1,
        };
        comments.set(next.id, next);
        return Response.json({ comment: next });
    };
    return { transitions };
}

type Screen = Awaited<ReturnType<typeof renderScreen>>;

function composerPart(screen: Screen, containerTestID: string, partTestID: string, handler: 'onChangeText' | 'onPress') {
    const container = screen.findByTestId(containerTestID);
    expect(container, containerTestID).not.toBeNull();
    const part = container!.findAll((node) => node.props.testID === partTestID && typeof node.props[handler] === 'function')[0];
    expect(part, `${containerTestID} › ${partTestID}`).toBeDefined();
    return part!;
}

/** Types into the one composer mounted under `containerTestID` and presses its Send. */
async function sendThroughComposer(screen: Screen, containerTestID: string, text: string) {
    await act(async () => {
        changeTextTestInstance(composerPart(screen, containerTestID, 'new-session-composer-input', 'onChangeText'), text);
    });
    await act(async () => {
        await composerPart(screen, containerTestID, 'new-session-composer-send', 'onPress').props.onPress();
    });
    await flush();
}

const IDENTITY_A = 'a'.repeat(64);
const IDENTITY_B = 'b'.repeat(64);

/** A second reviewer of the same review (same `display.groupId`), as the run host lists and returns it. */
function serveSibling(params: Readonly<{ runId: string; agentId: string; status?: string; payload?: any }>) {
    const run = {
        runId: params.runId, callId: `call_${params.runId}`, sidechainId: `side_${params.runId}`, intent: 'review',
        backendTarget: { kind: 'builtInAgent', agentId: params.agentId }, display: { groupId: 'review_group_1' },
        permissionMode: 'default', retentionPolicy: 'resumable', runClass: 'bounded', ioMode: 'streaming',
        status: params.status ?? 'succeeded', startedAtMs: 2,
    };
    sessionExecutionRunListSpy.mockResolvedValue({ runs: [
        { ...run, runId: 'run_1', backendTarget: { kind: 'builtInAgent', agentId: 'claude' }, startedAtMs: 1 },
        run,
    ] });
    sessionExecutionRunGetSpy.mockImplementation(async (_sessionId: string, request: { runId: string }) => (
        request.runId === params.runId
            ? { run, ...(params.payload ? { structuredMeta: { kind: 'review_findings.v2', payload: params.payload } } : {}) }
            : { ok: false, error: 'not found' }
    ));
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

let disposeHome: (() => void) | null = null;
beforeEach(async () => {
    // The app's own startup step for the synchronized draft repository (`app/_layout.tsx`).
    const { prepareSessionDraftPersistenceStorage } = await import('@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage');
    await prepareSessionDraftPersistenceStorage();
    const served = await serveActionHomes({
        homes: [
            { key: 'other', serverUrl: 'https://review-card-other.test', accountId: 'account-2' },
            { key: 'home', serverUrl: 'https://review-card-home.test', accountId: 'account-1' },
        ],
        route: (request) => homeRoute.current?.(request),
    });
    home.serverId = served.homes.home!.id;
    home.otherServerId = served.homes.other!.id;
    disposeHome = served.dispose;
});

afterEach(() => {
    disposeHome?.();
    disposeHome = null;
    homeRoute.current = null;
    retireActiveServerAccountScopeLifetime();
    invalidateAccountEncryptionModeCache();
    resetReviewRunCommentsForTests();
    resetSessionDraftRepositoryForTests();
    sessionExecutionRunActionSpy.mockReset();
    sessionExecutionRunActionSpy.mockImplementation(async () => ({ ok: true }));
    sessionExecutionRunListSpy.mockReset();
    sessionExecutionRunListSpy.mockResolvedValue({ runs: [] });
    sessionExecutionRunGetSpy.mockReset();
    sessionExecutionRunGetSpy.mockResolvedValue({ ok: false, error: 'not found' });
    submitMessageSpy.mockClear();
    useSessionMessagesSpy.mockReturnValue({ messages: [], isLoaded: true });
});

// Imported after the module mocks above are installed (a static import would load the real modules),
// once, so no single test pays the card's cold import.
let ReviewFindingsMessageCard!: typeof import('./ReviewFindingsMessageCard').ReviewFindingsMessageCard;
beforeAll(async () => {
    ({ ReviewFindingsMessageCard } = await import('./ReviewFindingsMessageCard'));
}, 600_000);

describe('ReviewFindingsMessageCard', () => {
    it('reads each decision from the finding\'s ReviewComment and writes a new one as a CAS transition, visible in every mount', async () => {
        const server = serveComments([commentFor('f1', { reviewTriageStatus: 'reject', state: 'dismissed' }), commentFor('f2')]);
        const payload = payloadFor([finding('f1', 'high'), finding('f2', 'low')]);
        const card = await renderWithSessionTranscriptSource(<ReviewFindingsMessageCard serverId={home.serverId} payload={payload} sessionId="sess_1" canSendMessages />);
        await flush();
        expect(card.findByTestId('review-finding-triage:f1:reject')!.props.accessibilityState).toMatchObject({ checked: true });

        await act(async () => {
            await card.pressByTestIdAsync('review-finding-triage:f2:accept');
        });
        await flush();

        expect(server.transitions).toEqual([expect.objectContaining({
            commentId: 'comment-f2',
            expectedState: 'proposed',
            expectedServerRevision: 3,
            toState: 'open',
            reviewTriageStatus: 'accept',
        })]);
        // The run overlay is gone: no review.triage action is sent.
        expect(sessionExecutionRunActionSpy).not.toHaveBeenCalled();

        // The run pane's page reads the same decision from the same comment.
        const pane = await renderScreen(<ReviewFindingsMessageCard serverId={home.serverId} payload={payload} sessionId="sess_1" canSendMessages presentation="page" />);
        await flush();
        expect(pane.findByTestId('review-finding-triage:f2:accept')!.props.accessibilityState).toMatchObject({ checked: true });
        expect(pane.findByTestId('review-finding-triage:f1:reject')!.props.accessibilityState).toMatchObject({ checked: true });
    });

    it('implements exactly the chosen fixes with the verify-first instructions and current comment revisions', async () => {
        serveComments([
            commentFor('f1', { reviewTriageStatus: 'accept', state: 'open', serverRevision: 7 }),
            commentFor('f2', { reviewTriageStatus: 'defer' }),
        ]);
        const screen = await renderScreen(
            <ReviewFindingsMessageCard serverId={home.serverId} payload={payloadFor([finding('f1', 'high'), finding('f2', 'low')])} sessionId="sess_1" canSendMessages presentation="page" />,
        );
        await flush();

        await act(async () => {
            await screen.pressByTestIdAsync('review-findings-publish-accepted');
        });
        await flush();

        expect(submitMessageSpy).toHaveBeenCalledTimes(1);
        const [sessionId, text] = submitMessageSpy.mock.calls[0]! as unknown as [string, string];
        expect(sessionId).toBe('sess_1');
        expect(text.startsWith(REVIEW_FINDINGS_VERIFY_AND_FIX_INSTRUCTIONS_V1)).toBe(true);
        expect(text).toContain('comment-f1');
        expect(text).toContain('"expectedServerRevision": 7');
        expect(text).not.toContain('comment-f2');
    });

    it('leaves out of Implement a fix that was switched to Ignore while the decisions were being re-read', async () => {
        serveComments([
            commentFor('f1', { reviewTriageStatus: 'accept', state: 'open', serverRevision: 7 }),
            commentFor('f2', { reviewTriageStatus: 'accept', state: 'open', serverRevision: 5 }),
        ], (listCount, comments) => {
            // The re-read Implement does: meanwhile f1 was ignored on another surface.
            if (listCount === 2) {
                const f1 = comments.get('comment-f1')!;
                comments.set('comment-f1', { ...f1, state: 'dismissed', reviewTriageStatus: 'reject', serverRevision: 8 });
            }
        });
        const screen = await renderScreen(
            <ReviewFindingsMessageCard serverId={home.serverId} payload={payloadFor([finding('f1', 'high'), finding('f2', 'low')])} sessionId="sess_1" canSendMessages presentation="page" />,
        );
        await flush();

        await act(async () => {
            await screen.pressByTestIdAsync('review-findings-publish-accepted');
        });
        await flush();

        expect(submitMessageSpy).toHaveBeenCalledTimes(1);
        const text = (submitMessageSpy.mock.calls[0]! as unknown as [string, string])[1];
        expect(text).toContain('comment-f2');
        expect(text).not.toContain('comment-f1');
    });

    it('asks the reviewer that found a finding in that finding\'s own thread', async () => {
        serveComments([commentFor('f1')]);
        useSessionMessagesSpy.mockReturnValue({
            isLoaded: true,
            messages: [{
                id: 'follow_up_1', kind: 'agent-text', localId: null, createdAt: 2, text: '',
                meta: { happier: { kind: 'review_follow_up.v1', payload: {
                    parentRunRef: { runId: 'run_1', callId: 'call_1', backendId: 'claude' },
                    threadId: 'thread_f1',
                    findingIds: ['f1'],
                    requestMarkdown: 'Does it paint?',
                    answerMarkdown: 'Only on iOS; lowered to Low.',
                    updatedFindings: [finding('f1', 'low')],
                    generatedAtMs: 2,
                } } },
            }],
        });
        const screen = await renderScreen(
            <ReviewFindingsMessageCard serverId={home.serverId} payload={payloadFor([finding('f1', 'medium')])} sessionId="sess_1" canSendMessages presentation="page" />,
        );
        await flush();

        // The answer changed the finding: its latest version shows, marked as updated.
        expect(screen.findByTestId('review-finding-updated:f1')).not.toBeNull();
        await act(async () => {
            await screen.pressByTestIdAsync('review-finding-replies:f1');
        });
        expect(screen.findByTestId('review-finding-thread:f1')).not.toBeNull();

        await sendThroughComposer(screen, 'review-finding-ask-field:f1', 'Narrow it to iOS?');
        // The thread names who answers: the reviewer that found it.
        expect(screen.findByTestId('review-finding-ask-field:f1:recipient')!.props.accessibilityLabel)
            .toMatch(/^runPage\.review\.toReviewer:/);

        expect(sessionExecutionRunActionSpy).toHaveBeenCalledWith('sess_1', {
            runId: 'run_1',
            actionId: 'review.follow_up',
            input: { findingIds: ['f1'], threadId: 'thread_f1', messageMarkdown: 'Narrow it to iOS?' },
        }, { serverId: home.serverId, scope: { serverId: home.serverId, accountId: 'account-1' } });
    });

    it('shows Ask about this disabled, with the reason, when the review cannot take follow-ups', async () => {
        serveComments([commentFor('f1')]);
        const screen = await renderScreen(
            <ReviewFindingsMessageCard serverId={home.serverId} payload={payloadFor([finding('f1', 'high')], { retentionPolicy: 'ephemeral' })} sessionId="sess_1" canSendMessages presentation="page" />,
        );
        await flush();

        const ask = screen.findByTestId('review-finding-ask:f1')!;
        expect(ask.props.disabled).toBe(true);
        expect(ask.props.accessibilityHint).toBe('This review ended; follow-ups need a review that stays open.');
        expect(screen.findByTestId('review-findings-follow-up-unavailable')).not.toBeNull();
        expect(screen.findByTestId('review-findings-follow-up')).toBeNull();
    });

    it('shows the card\'s derived headline and its first three findings, most severe first', async () => {
        serveComments([]);
        const screen = await renderWithSessionTranscriptSource(
            <ReviewFindingsMessageCard serverId={home.serverId}
                payload={payloadFor([finding('f1', 'low'), finding('f2', 'high'), finding('f3', 'medium'), finding('f4', 'nit')])}
                sessionId="sess_1"
                canSendMessages
            />,
        );
        await flush();

        expect(screen.findAllByType('Text').some((node) => node.props.children === '4 findings · 1 high')).toBe(true);
        expect(screen.findByTestId('review-finding:f2')).not.toBeNull();
        expect(screen.findByTestId('review-finding:f4')).toBeNull();
        await act(async () => {
            await screen.pressByTestIdAsync('review-findings-show-more');
        });
        expect(screen.findByTestId('review-finding:f4')).not.toBeNull();
    });

    it('offers no decision, question or fix once the transcript is read-only', async () => {
        serveComments([commentFor('f1', { reviewTriageStatus: 'accept', state: 'open' })]);
        const screen = await renderScreen(
            <ReviewFindingsMessageCard serverId={home.serverId} payload={payloadFor([finding('f1', 'high')])} sessionId="sess_1" canSendMessages={false} presentation="page" />,
        );
        await flush();

        expect(screen.findByTestId('review-finding-triage:f1:accept')).toBeNull();
        expect(screen.findByTestId('review-finding-ask:f1')).toBeNull();
        expect(screen.findByTestId('review-findings-publish-accepted')).toBeNull();
        expect(screen.findByTestId('review-findings-follow-up')).toBeNull();
    });

    it('keeps a question typed in the one composer when the review could not take it', async () => {
        serveComments([commentFor('f1')]);
        sessionExecutionRunActionSpy.mockResolvedValueOnce({ ok: false, errorCode: 'execution_run_busy', error: 'busy' });
        const screen = await renderScreen(
            <ReviewFindingsMessageCard serverId={home.serverId} payload={payloadFor([finding('f1', 'high')])} sessionId="sess_1" canSendMessages presentation="page" />,
        );
        await flush();

        await sendThroughComposer(screen, 'review-findings-follow-up', 'Is the key per tenant?');

        expect(sessionExecutionRunActionSpy).toHaveBeenCalledWith('sess_1', {
            runId: 'run_1', actionId: 'review.follow_up', input: { findingIds: [], messageMarkdown: 'Is the key per tenant?' },
        }, { serverId: home.serverId, scope: { serverId: home.serverId, accountId: 'account-1' } });
        expect(composerPart(screen, 'review-findings-follow-up', 'new-session-composer-input', 'onChangeText').props.value)
            .toBe('Is the key per tenant?');

        await act(async () => {
            await composerPart(screen, 'review-findings-follow-up', 'new-session-composer-send', 'onPress').props.onPress();
        });
        await flush();
        expect(composerPart(screen, 'review-findings-follow-up', 'new-session-composer-input', 'onChangeText').props.value).toBe('');
    });

    it('keeps the result\'s unsent follow-up in the run\'s draft when the pane closes and opens again', async () => {
        serveComments([commentFor('f1')]);
        const page = <ReviewFindingsMessageCard serverId={home.serverId} payload={payloadFor([finding('f1', 'high')])} sessionId="sess_1" canSendMessages presentation="page" />;
        const first = await renderScreen(page);
        await flush();
        await act(async () => {
            changeTextTestInstance(composerPart(first, 'review-findings-follow-up', 'new-session-composer-input', 'onChangeText'), 'Half a question');
        });
        await act(async () => {
            first.tree.unmount();
        });

        const second = await renderScreen(page);
        await flush();
        expect(composerPart(second, 'review-findings-follow-up', 'new-session-composer-input', 'onChangeText').props.value).toBe('Half a question');
    });

    it('keeps the finding follow-up in the same run draft when its thread closes and opens again', async () => {
        serveComments([commentFor('f1')]);
        const screen = await renderScreen(<ReviewFindingsMessageCard serverId={home.serverId}
            payload={payloadFor([finding('f1', 'high')])} sessionId="sess_1" canSendMessages presentation="page" />);
        await flush();
        await screen.pressByTestIdAsync('review-finding-ask:f1');
        await act(async () => {
            changeTextTestInstance(composerPart(screen, 'review-finding-ask-field:f1', 'new-session-composer-input', 'onChangeText'), 'Check the iOS path?');
        });
        await screen.pressByTestIdAsync('review-finding-ask:f1');
        await screen.pressByTestIdAsync('review-finding-ask:f1');
        expect(composerPart(screen, 'review-finding-ask-field:f1', 'new-session-composer-input', 'onChangeText').props.value).toBe('Check the iOS path?');
        expect(screen.findByTestId('review-findings-follow-up')).toBeNull();
    });

    it.each(['distinct comments', 'shared comment', 'shared comment changed on reread', 'read-only'] as const)('shows multi-reviewer results with %s as merged "Both" rows', async (mode) => {
        const shared = mode.startsWith('shared comment');
        const canAct = mode !== 'read-only';
        const reference = { id: 'comment-f1', state: 'proposed', serverRevision: 3, workspace: WORKSPACE, sessionId: 'sess_1', runId: 'earlier_round' };
        const claudeF1 = finding('f1', 'medium', { title: 'Key reused across tenants', ...(shared ? { comment: reference } : {}) });
        const codexG1 = finding('g1', 'high', { title: 'Tenant key collides', ...(shared ? { comment: reference } : {}) });
        const codexG2 = finding('g2', 'low');
        let applying = false;
        let applyReads = 0;
        const server = serveComments([
            commentFor('f1', { findingIdentity: IDENTITY_A, ...(shared ? { runId: 'earlier_round' } : {}) }),
            ...(shared ? [] : [commentFor('g1', { id: 'comment-g1', runId: 'run_2', findingIdentity: IDENTITY_A })]),
            commentFor('g2', { id: 'comment-g2', runId: 'run_2', findingIdentity: IDENTITY_B }),
        ], undefined, (_getCount, comments) => {
            if (applying) applyReads += 1;
            if (mode === 'shared comment changed on reread' && applyReads === 2) {
                const comment = comments.get('comment-f1')!;
                comments.set(comment.id, { ...comment, state: 'dismissed', reviewTriageStatus: 'reject', serverRevision: 5 });
            }
        });
        serveSibling({ runId: 'run_2', agentId: 'codex', payload: { ...payloadFor([codexG1, codexG2], { runId: 'run_2', callId: 'call_2', backendId: 'codex' }), summary: 'Codex agrees on the key.' } });
        const screen = await renderScreen(
            <ReviewFindingsMessageCard serverId={home.serverId} payload={payloadFor([claudeF1])} sessionId="sess_1" canSendMessages={canAct} presentation="page" groupId="review_group_1" />,
        );
        await flush();

        // Both reviewers, each with its own summary; one merged row plus the second reviewer's own.
        expect(screen.findByTestId('review-reviewer:run_1')).not.toBeNull();
        expect(screen.findByTestId('review-reviewer:run_2')).not.toBeNull();
        expect(screen.getTextContent()).toContain('Codex agrees on the key.');
        expect(screen.findByTestId('review-finding:run_1:f1')).not.toBeNull();
        expect(screen.findByTestId('review-finding:run_2:g1')).toBeNull();
        expect(screen.findByTestId('review-finding:run_2:g2')).not.toBeNull();
        expect(screen.findByTestId('review-finding-attribution:run_1:f1')!
            .findAll((node) => node.props.children === 'runPage.review.both')).not.toHaveLength(0);
        expect(screen.findByTestId('review-findings-headline')!.props.children)
            .toBe('runPage.review.reviewerCount:{"count":2} · 2 findings · 1 high');

        if (!canAct) {
            expect(screen.findByTestId('review-finding-triage:run_1:f1:accept')).toBeNull();
            return;
        }

        // One decision on a merged row is recorded on each reviewer's comment.
        await act(async () => {
            await screen.pressByTestIdAsync('review-finding-triage:run_1:f1:accept');
        });
        await flush();
        expect(server.transitions.map((transition) => transition.commentId).sort()).toEqual(shared ? ['comment-f1'] : ['comment-f1', 'comment-g1']);
        if (shared) {
            applying = true;
            await screen.pressByTestIdAsync('review-findings-publish-accepted');
            await flush();
            if (mode === 'shared comment changed on reread') {
                expect(applyReads).toBe(2);
                expect(submitMessageSpy).not.toHaveBeenCalled();
            } else {
                expect(submitMessageSpy).toHaveBeenCalledTimes(1);
                const text = submitMessageSpy.mock.calls[0]![1] as string;
                expect(text.match(/"commentId": "comment-f1"/g)).toHaveLength(1);
            }
        }

        // A question on it goes to both reviewers, each in its own thread about its own finding.
        await act(async () => {
            await screen.pressByTestIdAsync('review-finding-ask:run_1:f1');
        });
        await sendThroughComposer(screen, 'review-finding-ask-field:run_1:f1', 'Same key in both places?');
        expect(sessionExecutionRunActionSpy.mock.calls.map(([, request]) => request)).toEqual(expect.arrayContaining([
            { runId: 'run_1', actionId: 'review.follow_up', input: { findingIds: ['f1'], messageMarkdown: 'Same key in both places?' } },
            { runId: 'run_2', actionId: 'review.follow_up', input: { findingIds: ['g1'], messageMarkdown: 'Same key in both places?' } },
        ]));
    });

    it('lists a reviewer of the group that did not finish instead of dropping it', async () => {
        serveComments([commentFor('f1')]);
        serveSibling({ runId: 'run_2', agentId: 'codex', status: 'failed' });
        const screen = await renderScreen(
            <ReviewFindingsMessageCard serverId={home.serverId} payload={payloadFor([finding('f1', 'high')])} sessionId="sess_1" canSendMessages presentation="page" groupId="review_group_1" />,
        );
        await flush();

        expect(screen.findByTestId('review-reviewer:run_2')).not.toBeNull();
        expect(screen.getTextContent()).toContain('runPage.review.reviewerDidNotFinish');
        expect(screen.findByTestId('review-findings-headline')!.props.children)
            .toBe('runPage.review.reviewerCount:{"count":2} · 1 findings · 1 high');
        // A single completed result keeps its own finding ids.
        expect(screen.findByTestId('review-finding:f1')).not.toBeNull();
    });

    it('withdraws another Home\'s reviewer results when the new Home cannot load the group', async () => {
        serveComments([]);
        serveSibling({ runId: 'run_2', agentId: 'codex', status: 'failed' });
        const props = { payload: payloadFor([finding('f1', 'high')]), sessionId: 'sess_1', canSendMessages: false,
            presentation: 'page' as const, groupId: 'review_group_1' };
        const screen = await renderScreen(<ReviewFindingsMessageCard {...props} serverId={home.serverId} />);
        await flush();
        expect(screen.findByTestId('review-reviewer:run_2')).not.toBeNull();
        sessionExecutionRunListSpy.mockRejectedValue(new Error('offline'));
        await screen.update(<ReviewFindingsMessageCard {...props} serverId={home.otherServerId} />);
        await flush();
        expect(screen.findByTestId('review-reviewer:run_2')).toBeNull();
    });
});
