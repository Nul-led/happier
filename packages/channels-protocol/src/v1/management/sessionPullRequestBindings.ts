import { defineProtocolArray, defineProtocolLiteral, defineProtocolNumber, defineProtocolObject, defineProtocolString, defineProtocolUnion } from '@happier-dev/plugin-sdk/protocol';
import { SessionIdSchema } from '@happier-dev/plugin-sdk/sessions';
import { AutomationIdV1Schema } from '@happier-dev/plugin-sdk/automations';
import { ConversationBindingIdV1ProtocolSchema } from '../identity.js';
import type { ConversationBindingV1 } from './targets.js';

export const SESSION_PULL_REQUEST_BINDING_ACTION_ID_V1 = 'session-pull-request-binding-v1';
const conversationPullRequestFieldsV1 = {
  repository: defineProtocolString({ minLength: 1, pattern: '^[^\\s/]+/[^\\s/]+$' }),
  number: defineProtocolNumber({ integer: true, minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
};
export const ConversationPullRequestV1Schema = defineProtocolObject(conversationPullRequestFieldsV1, { policy: 'closed' });
export const ConversationScopedPullRequestTriggerV1Schema = defineProtocolObject({
  sessionId: SessionIdSchema,
  triggerId: defineProtocolString({ minLength: 1 }),
  triggerRevision: defineProtocolNumber({ integer: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  triggerKind: defineProtocolUnion([defineProtocolLiteral('prComment'), defineProtocolLiteral('ciFailed')]),
  principalPolicy: defineProtocolLiteral('repositoryWriters'),
  pullRequest: ConversationPullRequestV1Schema,
}, { policy: 'closed' });
export type ConversationScopedPullRequestTriggerV1 = ReturnType<typeof ConversationScopedPullRequestTriggerV1Schema.parse>;
export const SessionPullRequestBindingInputV1Schema = defineProtocolUnion([
  defineProtocolObject({
    kind: defineProtocolLiteral('attach'), sessionId: SessionIdSchema, pullRequest: ConversationPullRequestV1Schema,
    target: defineProtocolObject({
      automationId: AutomationIdV1Schema, triggerId: defineProtocolString({ minLength: 1 }),
      triggerRevision: defineProtocolNumber({ integer: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      triggerKind: defineProtocolUnion([defineProtocolLiteral('prComment'), defineProtocolLiteral('ciFailed')]),
    }, { policy: 'closed' }).optional(),
  }, { policy: 'closed' }),
  defineProtocolObject({ kind: defineProtocolLiteral('list'), sessionId: SessionIdSchema }, { policy: 'closed' }),
  defineProtocolObject({ kind: defineProtocolLiteral('removeTrigger'), sessionId: SessionIdSchema, triggerId: defineProtocolString({ minLength: 1 }) }, { policy: 'closed' }),
]);
export type SessionPullRequestBindingInputV1 = ReturnType<typeof SessionPullRequestBindingInputV1Schema.parse>;
const sessionPullRequestLinksFieldsV1 = {
  sessionId: SessionIdSchema,
  pullRequestLinks: defineProtocolArray(defineProtocolObject({
    provider: defineProtocolLiteral('github'),
    ...conversationPullRequestFieldsV1,
  }, { policy: 'closed' })),
};
export const SessionPullRequestLinksV1Schema = defineProtocolObject(sessionPullRequestLinksFieldsV1, { policy: 'closed' });
export type SessionPullRequestLinksV1 = ReturnType<typeof SessionPullRequestLinksV1Schema.parse>;

/** Opened PR links are a projection of retained bindings, not trigger enablement. */
export function resolveSessionPullRequestLinksV1(bindings: readonly ConversationBindingV1[]): SessionPullRequestLinksV1[] {
  type PullRequestLink = SessionPullRequestLinksV1['pullRequestLinks'][number];
  const linksBySession = new Map<string, PullRequestLink[]>();
  const seen = new Map<string, Set<string>>();
  for (const binding of [...bindings].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))) {
    if (binding.deletionState !== 'none') continue;
    const sessionId = binding.target.kind === 'session' ? binding.target.sessionId : binding.target.scopedTrigger?.sessionId;
    const pullRequest = binding.target.kind === 'session' ? binding.target.pullRequestLink : binding.target.scopedTrigger?.pullRequest;
    if (sessionId === undefined || pullRequest === undefined) continue;
    let links = linksBySession.get(sessionId);
    if (links === undefined) {
      links = [];
      linksBySession.set(sessionId, links);
      seen.set(sessionId, new Set());
    }
    const key = JSON.stringify([pullRequest.repository, pullRequest.number]);
    const distinct = seen.get(sessionId)!;
    if (distinct.has(key)) continue;
    distinct.add(key);
    links.push({ provider: 'github', ...pullRequest });
  }
  return [...linksBySession].map(([sessionId, pullRequestLinks]) => ({ sessionId, pullRequestLinks }));
}

export const SessionPullRequestBindingResultV1Schema = defineProtocolUnion([
  defineProtocolObject({ kind: defineProtocolLiteral('attached'), bindingId: ConversationBindingIdV1ProtocolSchema }, { policy: 'closed' }),
  defineProtocolObject({
    kind: defineProtocolLiteral('links'),
    ...sessionPullRequestLinksFieldsV1,
  }, { policy: 'closed' }),
  defineProtocolObject({ kind: defineProtocolLiteral('removed') }, { policy: 'closed' }),
]);
export type SessionPullRequestBindingResultV1 = ReturnType<typeof SessionPullRequestBindingResultV1Schema.parse>;
