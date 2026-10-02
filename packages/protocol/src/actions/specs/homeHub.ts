import { z } from 'zod';
import { HomeHubLayoutV1Schema } from '../../account/settings/accountSettings.js';
import type { PreNormalizedActionSpec } from '../actionSpecs.js';

export const HOME_HUB_LAYOUT_ACTION_IDS = ['home.hub.layout.get', 'home.hub.layout.update', 'home.reachNudge.dismiss'] as const;
export type HomeHubLayoutActionId = typeof HOME_HUB_LAYOUT_ACTION_IDS[number];

const sectionId = z.string().min(1);
export const HomeHubLayoutIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), sectionId, step: z.union([z.literal(-1), z.literal(1)]) }).strict(),
  z.object({ kind: z.literal('reorder'), sectionIds: z.array(sectionId) }).strict(),
  z.object({ kind: z.literal('visibility'), sectionId, hidden: z.boolean() }).strict(),
  z.object({ kind: z.literal('frameStyle'), sectionId, frameStyle: z.enum(['card', 'plain']).nullable() }).strict(),
  z.object({ kind: z.literal('setup_visibility'), stepId: z.string().trim().min(1), hidden: z.boolean() }).strict(),
  z.object({ kind: z.literal('restore_setup') }).strict(),
  z.object({ kind: z.literal('reset') }).strict(),
]);
export type HomeHubLayoutIntent = z.infer<typeof HomeHubLayoutIntentSchema>;

export const HomeHubLayoutGetInputSchema = z.object({}).strict();
export const HomeHubLayoutUpdateInputSchema = z.object({ intent: HomeHubLayoutIntentSchema }).strict();
export const HomeReachNudgeDismissInputSchema = z.object({ homeServerId: z.string().trim().min(1) }).strict();
export const HomeReachNudgeDismissResultSchema = z.object({ homeIdentityId: z.string().min(1), dismissed: z.literal(true) }).strict();
export const HomeHubLayoutResultSchema = z.object({
  layout: HomeHubLayoutV1Schema.strict(),
  sections: z.array(z.object({ id: sectionId, kind: z.enum(['builtin', 'widget']), hidden: z.boolean(), hideable: z.boolean(), frameStyle: z.enum(['card', 'plain']).optional() }).strict()),
  availableWidgetIds: z.array(sectionId),
  hiddenSetupStepIds: z.array(sectionId),
}).strict();

export const HOME_HUB_LAYOUT_ACTION_SPECS = [
  {
    id: 'home.reachNudge.dismiss', title: 'Dismiss Home reachability suggestion',
    description: 'Permanently dismiss the selected Home’s reachability suggestion on this client device. Other devices are unchanged.',
    safety: 'safe', sideEffectClass: 'write', executionPlacement: 'client', placements: [],
    bindings: { mcpToolName: 'home_reach_nudge_dismiss', voiceClientToolName: 'dismissHomeReachNudge' },
    surfaces: { ui: true, voice: true, agent: true, mcp: true, cli: false, rpc: false },
    inputSchema: HomeReachNudgeDismissInputSchema, outputSchema: HomeReachNudgeDismissResultSchema,
    inputHints: { fields: [{ path: 'homeServerId', title: 'Saved Home ID', widget: 'text', required: true }] },
  },
  {
    id: 'home.hub.layout.get', title: 'Read Home customization',
    description: 'Read the current client’s Home section order, visibility and available plugin widgets.',
    safety: 'safe', sideEffectClass: 'read', executionPlacement: 'client', placements: [],
    bindings: { mcpToolName: 'home_hub_layout_get', voiceClientToolName: 'readHomeLayout' },
    surfaces: { ui: true, voice: true, agent: true, mcp: true, cli: false, rpc: false },
    inputSchema: HomeHubLayoutGetInputSchema, outputSchema: HomeHubLayoutResultSchema,
    inputHints: { fields: [] },
  },
  {
    id: 'home.hub.layout.update', title: 'Customize Home',
    description: 'Reorder, move, show or hide Home sections and widgets, set or clear a frame style override, mark or dismiss individual setup steps, restore them or reset the layout. Start and attention stay visible.',
    safety: 'safe', sideEffectClass: 'write', executionPlacement: 'client', placements: [],
    bindings: { mcpToolName: 'home_hub_layout_update', voiceClientToolName: 'customizeHomeLayout' },
    surfaces: { ui: true, voice: true, agent: true, mcp: true, cli: false, rpc: false },
    inputSchema: HomeHubLayoutUpdateInputSchema, outputSchema: HomeHubLayoutResultSchema,
    inputHints: { fields: [{ path: 'intent', title: 'Customization intent', widget: 'json', required: true,
      description: 'Use move, reorder, visibility, frameStyle (card/plain/null), setup_visibility (stepId, hidden), restore_setup or reset. setup_visibility with hidden=true marks or dismisses a step; hidden=false brings it back. Read the current layout first; reorder lists all sections returned by that read.' }] },
  },
] as const satisfies readonly PreNormalizedActionSpec[];
