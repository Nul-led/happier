import { buildClaudePredecessorMessageMeta as buildCanonicalClaudePredecessorMessageMeta } from '@happier-dev/protocol/agents/claude/predecessor-message-meta';
import { CLAUDE_REMOTE_AGENT_SETTINGS_DEFAULTS } from '../agentSettings/definition.js';

export const CLAUDE_PREDECESSOR_MESSAGE_META_DEFAULTS = CLAUDE_REMOTE_AGENT_SETTINGS_DEFAULTS;

export function buildClaudePredecessorMessageMeta(settings: Readonly<Record<string, unknown>>) {
    return buildCanonicalClaudePredecessorMessageMeta(settings, CLAUDE_PREDECESSOR_MESSAGE_META_DEFAULTS);
}

export const CLAUDE_PREDECESSOR_MESSAGE_META_WRITER = {
    buildPredecessorMessageMeta: buildClaudePredecessorMessageMeta,
} as const;
