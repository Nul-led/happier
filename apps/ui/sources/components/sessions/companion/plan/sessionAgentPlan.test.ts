import { describe, expect, it } from 'vitest';

import { projectSessionAgentPlan } from './sessionAgentPlan';

const todo = (id: string, content: string, status: 'pending' | 'in_progress' | 'completed') => ({
    id,
    content,
    status,
    priority: 'medium' as const,
});

describe('projectSessionAgentPlan', () => {
    it('has no plan until the agent has written a to-do list', () => {
        expect(projectSessionAgentPlan(undefined)).toBeNull();
        expect(projectSessionAgentPlan([])).toBeNull();
    });

    it('keeps the agent order and names the step it is on as N of M', () => {
        const plan = projectSessionAgentPlan([
            todo('a', 'Find why the modal remounts', 'completed'),
            todo('b', 'Key the modal by route', 'completed'),
            todo('c', 'Add a resize test', 'completed'),
            todo('d', 'Run the full UI suite', 'in_progress'),
            todo('e', 'Push and open the PR', 'pending'),
        ]);

        expect(plan).toMatchObject({ doneCount: 3, total: 5, currentStep: 4 });
        expect(plan?.steps.map((step) => step.status)).toEqual(['done', 'done', 'done', 'current', 'todo']);
        expect(plan?.steps[3]?.text).toBe('Run the full UI suite');
    });

    it('points at the next open step when nothing is marked in progress, and at none once all are done', () => {
        expect(projectSessionAgentPlan([
            todo('a', 'One', 'completed'),
            todo('b', 'Two', 'pending'),
        ])).toMatchObject({ doneCount: 1, total: 2, currentStep: null, nextStep: 2 });
        expect(projectSessionAgentPlan([
            todo('a', 'One', 'completed'),
            todo('b', 'Two', 'completed'),
        ])).toMatchObject({ doneCount: 2, total: 2, currentStep: null, nextStep: null });
    });

    it('returns the same projection for an unchanged list so the card does not re-render', () => {
        const list = [todo('a', 'One', 'in_progress')];
        expect(projectSessionAgentPlan(list)).toBe(projectSessionAgentPlan(list));
    });
});
