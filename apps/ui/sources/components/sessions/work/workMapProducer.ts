import { buildHappierWorkMap, type HappierWorkMap, type HappierWorkMapNodeDeclaration, type HappierWorkMapPlaced } from '@happier-dev/plugin-ui/presentation';

import type { WorkItem, WorkProjection, WorkStatus } from './workProjection';

/**
 * The Session and run producer for the neutral Work map (ORC §3.8 "Map", O11; lab `session-A2`,
 * `map-M1`): the lead at the root, each Session under the Session it reports to, and the workflows and
 * background runs the lead started under the lead. Every edge is one the Work projection already holds
 * (`reportsTo`, or "this Session started it"); nothing is inferred from order, time or workspace.
 * The lead's node carries no state of its own, so it stays neutral whatever its reports need (S-6).
 */
export type SessionWorkMapNodeDeclaration = HappierWorkMapNodeDeclaration & Readonly<{
    kind: 'lead' | WorkItem['kind'];
    status: WorkStatus | null;
    agentId: string | null;
    facts: readonly string[];
}>;

export type SessionWorkMapNode = HappierWorkMapPlaced<SessionWorkMapNodeDeclaration>;

export type SessionWorkMap = HappierWorkMap<SessionWorkMapNode>;

export function projectSessionWorkMap(input: Readonly<{
    leadSessionId: string;
    leadTitle: string;
    leadAgentId?: string | null;
    leadFacts?: readonly string[];
    projection: WorkProjection;
}>): SessionWorkMap {
    const leadNodeId = `session:${input.leadSessionId}`;
    const nodes: SessionWorkMapNodeDeclaration[] = [{
        nodeId: leadNodeId,
        label: input.leadTitle,
        parentNodeId: null,
        open: { kind: 'session', sessionId: input.leadSessionId },
        kind: 'lead',
        status: null,
        agentId: input.leadAgentId ?? null,
        facts: input.leadFacts ?? [],
    }];
    for (const item of input.projection.sessions) {
        if (item.open.kind !== 'session') continue;
        nodes.push({
            nodeId: item.key,
            label: item.title,
            parentNodeId: item.parentKey ?? leadNodeId,
            open: { kind: 'session', sessionId: item.open.sessionId },
            kind: item.kind,
            status: item.status,
            agentId: item.agentId,
            facts: item.facts,
        });
    }
    for (const item of [...input.projection.workflows, ...input.projection.backgroundRuns]) {
        const runId = item.open.kind === 'workflow_run'
            ? item.open.runId
            : item.open.kind === 'agent_activity' ? item.open.runId : null;
        if (!runId) continue;
        nodes.push({
            nodeId: item.key,
            label: item.title,
            parentNodeId: leadNodeId,
            open: { kind: 'run', runId },
            kind: item.kind,
            status: item.status,
            agentId: item.agentId,
            facts: item.facts,
        });
    }
    return buildHappierWorkMap({ relationships: 'authored', nodes });
}
