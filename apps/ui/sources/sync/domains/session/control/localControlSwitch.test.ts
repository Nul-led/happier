import { describe, expect, it } from 'vitest';
import {
  shouldRenderChatTimelineForSession,
  shouldRequestRemoteControl,
  shouldRequestRemoteControlAfterPendingEnqueue,
} from './localControlSwitch';
import type { Session } from '@/sync/domains/state/storageTypes';
import { createSessionFixture } from '@/dev/testkit';
import { MetadataSchema } from '@happier-dev/session-core/state';
import { resolveAgentCatalogProjection } from '@/agents/backendCatalog/agentCatalogProjection';
import { parseDecryptedSessionMetadata } from '@/sync/engine/sessions/parsePlainSessionPayload';

function connectedSession(bindings: unknown, flavor = 'acme.agent/native'): Session {
  return createSessionFixture({
    active: true,
    agentState: { controlledByUser: true },
    metadata: MetadataSchema.parse({
      path: '/workspace', host: 'test-machine', flavor, connectedServices: bindings,
      runtimeDescriptorV1: { v: 1, agentId: flavor, agent: {} },
    }),
  });
}

function installedAgentCatalog() {
  return resolveAgentCatalogProjection('acme.agent/native', {
    enabledAgentIds: ['acme.agent/native'],
    mergedProviderProjectionById: {
      'acme.agent/native': {
        agentId: 'acme.agent/native',
        qualifiedId: 'acme.agent/native',
        identity: { pluginId: 'acme.agent', localId: 'native' },
        isBuiltIn: false,
        connectedAccounts: [{
          purpose: 'primary', service: { pluginId: 'acme.account', localId: 'subscription' },
          required: false,
        }],
      },
    },
  });
}

describe('localControlSwitch', () => {
  it.each([
    { source: 'connected', profileId: 'work' },
    { source: 'connected', selection: 'group', groupId: 'work-pool' },
  ])('does not veto selected installed-Agent authentication with unrelated ambient logout: %j', (binding) => {
    const session = connectedSession({
      v: 2, bindingsByServiceId: { 'acme.account/subscription': binding },
    });
    expect(shouldRequestRemoteControl(session, 'logged_out', installedAgentCatalog())).toBe(true);
    // Explicit takeover eligibility never makes enqueue switch control implicitly.
    expect(shouldRequestRemoteControlAfterPendingEnqueue(session, 'logged_out')).toBe(false);
  });

  it.each([
    { source: 'team_resource', resourceId: 'team-subscription', deliveryMode: 'brokered' },
    {
      source: 'team_resource', resourceId: 'team-subscription', deliveryMode: 'direct',
      disclosedMember: {
        service: { pluginId: 'acme.account', localId: 'subscription' }, accountId: 'source-member',
      },
    },
  ])('does not treat ambient logout as selected Team credential validation: %j', (binding) => {
    const session = connectedSession({
      v: 2, bindingsByServiceId: { 'acme.account/subscription': binding },
    });
    expect(shouldRequestRemoteControl(session, 'logged_out', installedAgentCatalog())).toBe(true);
    expect(shouldRequestRemoteControlAfterPendingEnqueue(session, 'logged_out')).toBe(false);
  });

  it.each([
    { v: 2, bindingsByServiceId: { 'other.account/subscription': {
      source: 'team_resource', resourceId: 'team-subscription', deliveryMode: 'brokered',
    } } },
    { v: 2, bindingsByServiceId: { 'acme.account/subscription': {
      source: 'team_resource', deliveryMode: 'brokered',
    } } },
    { v: 2, bindingsByServiceId: { 'acme.account/subscription': {
      source: 'team_resource', resourceId: 'team-subscription', deliveryMode: 'direct',
    } } },
    { v: 2, bindingsByServiceId: { 'acme.account/subscription': {
      source: 'team_resource', resourceId: 'team-subscription', deliveryMode: 'brokered',
      disclosedMember: { service: { pluginId: 'acme.account', localId: 'subscription' }, accountId: 'source-member' },
    } } },
  ])('retains ambient logout gating for unrelated or malformed Team selections: %j', (bindings) => {
    expect(shouldRequestRemoteControl(connectedSession(bindings), 'logged_out', installedAgentCatalog())).toBe(false);
  });

  it.each([
    { v: 2, bindingsByServiceId: { 'other.account/subscription': { source: 'connected', profileId: 'work' } } },
    { v: 2, bindingsByServiceId: { 'acme.account/subscription': { source: 'native' } } },
    { v: 2, bindingsByServiceId: { 'acme.account/subscription': { source: 'connected' } } },
    { v: 2, bindingsByServiceId: { subscription: { source: 'connected', profileId: 'work' } } },
    { v: 3, bindingsByServiceId: { 'acme.account/subscription': { source: 'connected', profileId: 'work' } } },
  ])('retains ambient logout gating for unrelated, native, or invalid selections: %j', (bindings) => {
    expect(shouldRequestRemoteControl(connectedSession(bindings), 'logged_out', installedAgentCatalog())).toBe(false);
  });

  it('does not borrow another Agent catalog or infer support for unknown Agents', () => {
    const session = connectedSession({
      v: 2, bindingsByServiceId: { 'acme.account/subscription': { source: 'connected', profileId: 'work' } },
    }, 'other.agent/native');
    expect(shouldRequestRemoteControl(session, 'logged_out', installedAgentCatalog())).toBe(false);
    expect(shouldRequestRemoteControl(session, 'logged_out')).toBe(false);
  });

  it('reads selected authentication from the layout-v1 owner view, not the shared envelope', () => {
    const owner = connectedSession({
      v: 2, bindingsByServiceId: { 'acme.account/subscription': { source: 'connected', profileId: 'work' } },
    });
    const session = createSessionFixture({
      ...owner,
      metadataLayoutVersion: 1,
      metadata: parseDecryptedSessionMetadata({
        v: 1, agentPresentation: { agentId: 'acme.agent/native' },
      }, 1),
      ownerMetadataView: owner.metadata,
    });
    expect(shouldRequestRemoteControl(session, 'logged_out', installedAgentCatalog())).toBe(true);
    expect(shouldRequestRemoteControl({ ...session, ownerMetadataView: null }, 'logged_out', installedAgentCatalog())).toBe(false);
    expect(shouldRequestRemoteControl({ ...session, metadataLayoutVersion: 2 }, 'logged_out', installedAgentCatalog())).toBe(false);
  });

  it('does not read selected credentials from a withheld owner projection', () => {
    const session = connectedSession({
      v: 2, bindingsByServiceId: { 'acme.account/subscription': { source: 'connected', profileId: 'work' } },
    });
    expect(shouldRequestRemoteControl({ ...session, ownerMetadataView: null }, 'logged_out', installedAgentCatalog())).toBe(false);
  });

  it('does not replace an authoritative empty account-purpose projection with bundled support', () => {
    const session = connectedSession({
      v: 1, bindingsByServiceId: { 'claude-subscription': { source: 'connected', profileId: 'work' } },
    }, 'claude');
    const catalog = resolveAgentCatalogProjection('claude', {
      enabledAgentIds: ['claude'],
      mergedProviderProjectionById: {
        claude: { agentId: 'claude', qualifiedId: 'happier.agent.claude/claude', connectedAccounts: [] },
      },
    });
    expect(shouldRequestRemoteControl(session, 'logged_out', catalog)).toBe(false);
  });

  it('normalizes retained bundled scalar bindings through the canonical ingress when no projected catalog is available', () => {
    const session = connectedSession({
      v: 1, bindingsByServiceId: { 'claude-subscription': { source: 'connected', profileId: 'work' } },
    }, 'claude');
    expect(shouldRequestRemoteControl(session, 'logged_out')).toBe(true);
  });

  it('never enables explicit takeover for shared or inactive connected sessions', () => {
    const session = connectedSession({
      v: 2, bindingsByServiceId: { 'acme.account/subscription': { source: 'connected', profileId: 'work' } },
    });
    expect(shouldRequestRemoteControl({ ...session, active: false }, 'logged_out', installedAgentCatalog())).toBe(false);
    expect(shouldRequestRemoteControl({ ...session, agentState: {
      localControl: { attached: true, topology: 'shared', remoteWritable: true },
    } }, 'logged_out', installedAgentCatalog())).toBe(false);
  });
  it('does not request remote control when session is null', () => {
    expect(shouldRequestRemoteControlAfterPendingEnqueue(null)).toBe(false);
  });

  it('does not request remote control as a hidden side effect after pending enqueue', () => {
    expect(
      shouldRequestRemoteControlAfterPendingEnqueue({
        presence: 'online',
        agentState: { controlledByUser: true },
      } as Session),
    ).toBe(false);
  });

  it('does not request remote control when the CLI auth state is logged out', () => {
    expect(
      shouldRequestRemoteControl({
        presence: 'online',
        agentState: { controlledByUser: true },
      } as Session, 'logged_out'),
    ).toBe(false);
    expect(
      shouldRequestRemoteControlAfterPendingEnqueue({
        presence: 'online',
        agentState: { controlledByUser: true },
      } as Session, 'logged_out'),
    ).toBe(false);
  });

  it('does not request remote control when session is not controlled by user', () => {
    expect(
      shouldRequestRemoteControlAfterPendingEnqueue({
        presence: 'online',
        agentState: { controlledByUser: false },
      } as Session),
    ).toBe(false);
  });

  it('does not request remote control after pending enqueue for shared local attachment', () => {
    expect(
      shouldRequestRemoteControlAfterPendingEnqueue({
        presence: 'online',
        agentState: {
          controlledByUser: false,
          localControl: {
            attached: true,
            topology: 'shared',
            remoteWritable: true,
          },
        },
      } as Session),
    ).toBe(false);
  });

  it('renders the chat timeline when a session is controlled by user even with no messages yet', () => {
    expect(
      shouldRenderChatTimelineForSession({
        committedMessagesCount: 0,
        pendingMessagesCount: 0,
        controlledByUser: true,
      }),
    ).toBe(true);
  });

  it('renders the chat timeline when the footer must be shown even with no messages yet', () => {
    expect(
      shouldRenderChatTimelineForSession({
        committedMessagesCount: 0,
        pendingMessagesCount: 0,
        controlledByUser: false,
        forceRenderFooter: true,
      }),
    ).toBe(true);
  });

  it('does not render an empty chat timeline just to expose remote-to-local attachment UI', () => {
    // Remote -> local takeover is intentionally terminal-driven. Do not add a
    // footer-only transcript render path for an app-side "Switch to local" button.
    expect(
      shouldRenderChatTimelineForSession({
        committedMessagesCount: 0,
        pendingMessagesCount: 0,
        controlledByUser: false,
      }),
    ).toBe(false);
  });
});
