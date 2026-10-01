import { isBundledAgentId, type BundledAgentId } from '@happier-dev/agents';

/**
 * Which bundled Agent's mark an Agent contribution shows: the mark it names (`iconAgentId`), else the
 * bundled Agent it is (its `catalogAgentId`, or its own id). The Agent picker and every plugin mark
 * (a plugin shows the mark of the Agent it contributes) read this one rule, so a plugin that is the
 * Claude Agent draws Claude's logo everywhere, never a letter in one place and the logo in another.
 */
export function resolveAgentMarkAgentId(input: Readonly<{
    agentId: string;
    iconAgentId?: string | null;
    catalogAgentId?: string | null;
}>): BundledAgentId | null {
    if (isBundledAgentId(input.iconAgentId)) return input.iconAgentId;
    if (isBundledAgentId(input.catalogAgentId)) return input.catalogAgentId;
    if (isBundledAgentId(input.agentId)) return input.agentId;
    return null;
}
