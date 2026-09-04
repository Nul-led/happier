import {
    type AgentModelConfig,
    type AgentModelDescriptor,
} from '@happier-dev/plugin-sdk/agents';

import { ANTHROPIC_STATIC_MODELS } from '../provider/catalog.js';

export const CLAUDE_STATIC_MODELS: readonly AgentModelDescriptor[] = ANTHROPIC_STATIC_MODELS;

export const CLAUDE_AGENT_MODEL_CONFIG: AgentModelConfig = Object.freeze({
    supportsSelection: true,
    supportsFreeform: true,
    nonAcpApplyScope: 'next_prompt',
    dynamicProbe: 'auto',
    nativeCatalogObservation: {
        providerLocalId: 'anthropic',
        purpose: 'model_upstream',
        connectedServiceId: 'claude-subscription',
    },
    defaultMode: 'default',
    allowedModes: CLAUDE_STATIC_MODELS.map((model) => model.id),
    staticModels: CLAUDE_STATIC_MODELS,
} satisfies AgentModelConfig);
