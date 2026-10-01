import { describe, expect, it } from 'vitest';

import { resolveCodexAcpSessionModeSyncTarget } from './permissionMode.js';

describe('Codex ACP permission-mode session-mode policy', () => {
  it('uses known V2 choices without treating unknown current or stale V1 as already applied', () => {
    expect(resolveCodexAcpSessionModeSyncTarget({ permissionMode: 'safe-yolo', metadata: {
      sessionModesV2: { v: 2, agentId: 'codex', updatedAt: 2, currentModeId: null, availableModes: [{ id: 'mode_untrusted', name: 'Untrusted' }] },
      sessionModesV1: { currentModeId: 'mode_untrusted', availableModes: [{ id: 'mode_untrusted', name: 'Untrusted' }] },
    } })).toBe('mode_untrusted');
  });
  it('resolves a mode switch target from canonical session-mode metadata', () => {
    expect(resolveCodexAcpSessionModeSyncTarget({
      permissionMode: 'safe-yolo',
      metadata: {
        sessionModesV1: {
          currentModeId: 'default',
          availableModes: [
            { id: 'default', name: 'Default' },
            { id: 'mode_untrusted', name: 'Untrusted' },
          ],
        },
      },
    })).toBe('mode_untrusted');
  });

  it('returns null when the desired ACP session mode is already active', () => {
    expect(resolveCodexAcpSessionModeSyncTarget({
      permissionMode: 'read-only',
      metadata: {
        sessionModesV1: {
          currentModeId: 'read-only',
          availableModes: [
            { id: 'default', name: 'Default' },
            { id: 'read-only', name: 'Read only' },
          ],
        },
      },
    })).toBeNull();
  });

  it('falls back to the legacy ACP session-mode metadata alias', () => {
    expect(resolveCodexAcpSessionModeSyncTarget({
      permissionMode: 'yolo',
      metadata: {
        acpSessionModesV1: {
          currentModeId: 'default',
          availableModes: [
            { id: 'default', name: 'Default' },
            { id: 'danger-full-access', name: 'Danger full access' },
          ],
        },
      },
    })).toBe('danger-full-access');
  });
});
