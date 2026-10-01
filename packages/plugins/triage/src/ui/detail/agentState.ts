import type { SessionStateV1 } from '@happier-dev/plugin-sdk/ui';

/**
 * The one sentence the story rail's agent step says about a linked Session's
 * live state (r0.42), read from the host's canonical Session awareness
 * projection. Priority follows what the reader must do: a waiting permission,
 * then a failure, then work in progress, then rest states. A state the host
 * cannot name yields `null` rather than a guessed word.
 */
export type TriageAgentStatusV1 = Readonly<{
  labelKey: string;
  label: string;
  tone: 'warning' | 'danger' | 'info' | 'success' | 'muted';
  /** The agent is working now; the status pulses (reduced motion keeps it still). */
  live: boolean;
}>;

const STATUS = {
  permission: { label: 'Needs your permission', tone: 'warning', live: false },
  action: { label: 'Needs your attention', tone: 'warning', live: false },
  failed: { label: 'Failed', tone: 'danger', live: false },
  working: { label: 'Working', tone: 'info', live: true },
  input: { label: 'Waiting for your reply', tone: 'warning', live: false },
  ready: { label: 'Ready', tone: 'success', live: false },
  offline: { label: 'Offline', tone: 'muted', live: false },
  archived: { label: 'Archived', tone: 'muted', live: false },
} as const;

function status(id: keyof typeof STATUS): TriageAgentStatusV1 {
  return Object.freeze({ labelKey: `plugins.triage.surface.detail.agent.${id}`, ...STATUS[id] });
}

export function describeTriageAgentStatusV1(state: SessionStateV1): TriageAgentStatusV1 | null {
  switch (state.operational) {
    case 'permission_required': return status('permission');
    case 'action_required': return status('action');
    case 'failed': return status('failed');
    case 'working': return status('working');
    case 'pending_input': return status('input');
    case 'ready': return status('ready');
    default: break;
  }
  if (state.lifecycle === 'failed') return status('failed');
  if (state.lifecycle === 'archived' || state.lifecycle === 'cancelled') return status('archived');
  if (state.runtime === 'offline') return status('offline');
  if (state.runtime === 'working' || state.runtime === 'background_active') return status('working');
  return null;
}
