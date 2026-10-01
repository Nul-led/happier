import { describe, expect, it } from 'vitest';
import type { SessionStateV1 } from '@happier-dev/plugin-sdk/ui';

import { describeTriageAgentStatusV1 } from './agentState.js';

const state = (patch: Partial<SessionStateV1>): SessionStateV1 => ({
  sessionId: 'session-a',
  lifecycle: 'active',
  runtime: 'working',
  operational: 'working',
  pendingPermissions: [],
  ...patch,
} as SessionStateV1);

describe('the live agent status on the story rail', () => {
  it('says a waiting permission first, as the loud fact', () => {
    expect(describeTriageAgentStatusV1(state({ operational: 'permission_required', runtime: 'waiting' })))
      .toMatchObject({ labelKey: 'plugins.triage.surface.detail.agent.permission', tone: 'warning', live: false });
  });

  it('pulses only while the agent is actually working', () => {
    expect(describeTriageAgentStatusV1(state({})))
      .toMatchObject({ labelKey: 'plugins.triage.surface.detail.agent.working', tone: 'info', live: true });
    expect(describeTriageAgentStatusV1(state({ operational: 'ready', runtime: 'idle' })))
      .toMatchObject({ labelKey: 'plugins.triage.surface.detail.agent.ready', live: false });
  });

  it('names failure, offline and a finished Session in words', () => {
    expect(describeTriageAgentStatusV1(state({ operational: 'failed', lifecycle: 'failed' })))
      .toMatchObject({ labelKey: 'plugins.triage.surface.detail.agent.failed', tone: 'danger' });
    expect(describeTriageAgentStatusV1(state({ operational: 'none', runtime: 'offline' })))
      .toMatchObject({ labelKey: 'plugins.triage.surface.detail.agent.offline', tone: 'muted' });
    expect(describeTriageAgentStatusV1(state({ operational: 'none', runtime: 'idle', lifecycle: 'archived' })))
      .toMatchObject({ labelKey: 'plugins.triage.surface.detail.agent.archived', tone: 'muted' });
  });

  it('claims nothing it cannot read', () => {
    expect(describeTriageAgentStatusV1(state({ operational: 'none', runtime: 'unknown', lifecycle: 'unknown' })))
      .toBeNull();
  });
});
