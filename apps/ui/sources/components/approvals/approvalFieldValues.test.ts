import { describe, expect, it } from 'vitest';

import { describeApprovalActionFields, projectApprovalStructuredAnswers } from './approvalFieldValues';

describe('projectApprovalStructuredAnswers', () => {
    it('preserves the exact released scalar question and answer content', () => {
        expect(projectApprovalStructuredAnswers([
            { question: '  Use the compatibility path?  ', answer: '  Yes, once  ' },
        ])).toEqual({
            kind: 'valid',
            answers: [{ question: '  Use the compatibility path?  ', values: ['  Yes, once  '] }],
        });
    });

    it('reports a malformed entry instead of silently dropping it beside valid content', () => {
        expect(projectApprovalStructuredAnswers([
            { question: 'Shown question', values: ['Yes'] },
            { question: 'Malformed', values: [{ secret: 'must-not-render' }] },
        ])).toEqual({ kind: 'unrepresentable', reason: 'malformed_entry' });
    });

    it('reports an entry that carries no answer at all', () => {
        expect(projectApprovalStructuredAnswers([{ question: 'Empty', values: [] }]))
            .toEqual({ kind: 'unrepresentable', reason: 'malformed_entry' });
    });

    it('reports a duplicated question rather than an indistinguishable empty projection', () => {
        expect(projectApprovalStructuredAnswers([
            { question: 'Same question', values: ['A'] },
            { question: 'Same question', values: ['B'] },
        ])).toEqual({ kind: 'unrepresentable', reason: 'duplicate_question' });
    });

    it('reports an aggregate payload above the canonical protocol bound', () => {
        expect(projectApprovalStructuredAnswers(Array.from({ length: 16 }, (_, index) => ({
            question: `Question ${index}`,
            values: [`oversized-answer-${index}-${'x'.repeat(16_360)}`],
        })))).toEqual({ kind: 'unrepresentable', reason: 'exceeds_protocol_bounds' });
    });

    it('treats an absent answers field as carrying nothing rather than as malformed', () => {
        expect(projectApprovalStructuredAnswers([undefined]))
            .toEqual({ kind: 'valid', answers: [] });
    });
});

describe('describeApprovalActionFields', () => {
    it('presents a valid structured payload without withholding the decision', () => {
        const presentation = describeApprovalActionFields({
            actionId: 'session.user_action.answer',
            actionArgs: {
                sessionId: 'session-1',
                requestId: 'ask-1',
                answers: [{ question: 'Continue?', values: ['Yes'] }],
            },
        });

        expect(presentation.unrepresentable).toBeNull();
        expect(presentation.rows).toContainEqual(expect.objectContaining({
            kind: 'structuredAnswers',
            path: 'answers',
            answers: [{ question: 'Continue?', values: ['Yes'] }],
        }));
    });

    it('withholds the whole structured field and every value once one entry is unrepresentable', () => {
        const presentation = describeApprovalActionFields({
            actionId: 'session.user_action.answer',
            actionArgs: {
                sessionId: 'session-1',
                requestId: 'ask-1',
                answers: [
                    { question: 'Shown question', values: ['Yes'] },
                    { question: 'Malformed', values: [{ secret: 'must-not-render' }] },
                ],
            },
        });

        expect(presentation.unrepresentable).toEqual({ path: 'answers', reason: 'malformed_entry' });
        expect(presentation.rows).toContainEqual(expect.objectContaining({
            kind: 'unrepresentable',
            path: 'answers',
            reason: 'malformed_entry',
        }));
        // Nothing from the payload survives into the presentation: an approval must
        // never stringify an arbitrary JSON leaf, and partial content would imply the
        // reader saw everything they are consenting to.
        const serialized = JSON.stringify(presentation);
        expect(serialized).not.toContain('must-not-render');
        expect(serialized).not.toContain('Shown question');
    });

    it('withholds an over-bound structured field instead of dropping the row silently', () => {
        const presentation = describeApprovalActionFields({
            actionId: 'session.user_action.answer',
            actionArgs: {
                sessionId: 'session-1',
                requestId: 'ask-oversized',
                answers: Array.from({ length: 16 }, (_, index) => ({
                    question: `Question ${index}`,
                    values: [`oversized-answer-${index}-${'x'.repeat(16_360)}`],
                })),
            },
        });

        expect(presentation.unrepresentable).toEqual({ path: 'answers', reason: 'exceeds_protocol_bounds' });
        expect(JSON.stringify(presentation)).not.toContain('oversized-answer-0');
    });

    it('leaves ordinary scalar fields fully visible and approvable', () => {
        const presentation = describeApprovalActionFields({
            actionId: 'session.title.set',
            actionArgs: { sessionId: 'session-1', title: 'New title from MCP' },
        });

        expect(presentation.unrepresentable).toBeNull();
        expect(presentation.rows).toContainEqual(expect.objectContaining({
            kind: 'value',
            value: 'New title from MCP',
        }));
    });
});
