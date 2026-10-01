import { join } from 'node:path';

import { resolveProcessTeeLogPath } from '../proc/proc.mjs';
import { normalizeStackRuntimeOwnerStartedAt } from '../stack/runtime_owner_incarnation.mjs';

function normalizeTargetNames(runtimeState, remoteTargetNames) {
  const runtimeTargets = runtimeState?.remoteTargets && typeof runtimeState.remoteTargets === 'object'
    ? Object.keys(runtimeState.remoteTargets)
    : [];
  return [...new Set([...(Array.isArray(remoteTargetNames) ? remoteTargetNames : []), ...runtimeTargets])]
    .map((name) => String(name && typeof name === 'object' ? name.name ?? '' : name ?? '').trim())
    .filter(Boolean)
    .sort();
}

function isLocalServicePlacement(runtimeState, service) {
  const placement = runtimeState?.placement;
  const owner = placement && typeof placement === 'object'
    ? String(placement[service] ?? '').trim()
    : '';
  if (owner) return owner === 'local';
  return !normalizeStackRuntimeOwnerStartedAt(runtimeState?.startedAt);
}

export function resolveTuiRuntimeLogAttachments({
  stackBaseDir = '',
  runtimeState = null,
  remoteTargetNames = [],
} = {}) {
  const baseDir = String(stackBaseDir ?? '').trim();
  if (!baseDir) return [];

  const logsDir = join(baseDir, 'logs');
  const initialSince = normalizeStackRuntimeOwnerStartedAt(runtimeState?.startedAt);
  const attachments = [
    { id: 'runner', path: runtimeState?.logs?.runner },
    ...(isLocalServicePlacement(runtimeState, 'server') ? [{ id: 'server', path: join(logsDir, 'server.log') }] : []),
    ...(isLocalServicePlacement(runtimeState, 'expo')
      ? [{ id: 'expo', path: join(logsDir, 'expo.log') }, { id: 'ui', path: join(logsDir, 'ui.log') }]
      : []),
    ...normalizeTargetNames(runtimeState, remoteTargetNames).map((name) => ({
      id: `remote:${name}`,
      path: resolveProcessTeeLogPath({
        label: `remote:${name}`,
        env: { HAPPIER_STACK_LOG_TEE_DIR: logsDir },
      }),
      initialSince,
    })),
  ];

  const paths = new Set();
  return attachments.filter((attachment) => {
    const path = String(attachment.path ?? '').trim();
    if (!path || paths.has(path)) return false;
    paths.add(path);
    attachment.path = path;
    return true;
  });
}
