import { describe, expect, it } from 'vitest';

import { getSessionHostBridge } from '@/agent/runtime/bridges/session/SessionHostBridge';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';

// This slice uses the real bridge/catalog resolver. The older owner unit suite
// substitutes backend surfaces, which cannot prove restoration admission.
describe('recorded local Herdr restoration admission', () => {
  it.each(['local', 'foreign', 'retired'] as const)(
    'opens only an inactive local non-retired candidate (%s)', async (placement) => {
      const result = await getSessionHostBridge().evaluateAttachEligibility({
        credentials: { token: 'fixture-token', encryption: null },
        accountEncryptionMode: 'plain',
        rawSession: createSessionRecordFixture({
          id: 'recorded-herdr-session', active: false, encryptionMode: 'plain',
          metadata: JSON.stringify({
            flavor: 'claude', machineId: placement === 'foreign' ? 'other-machine' : 'this-machine',
            host: placement === 'foreign' ? 'other-host' : 'this-host',
            terminal: { mode: 'herdr', requested: 'herdr', herdr: {
              sessionName: 'work', socketPath: '/fixture/recorded.sock',
              terminalId: 'old-runtime-terminal', paneId: 'w1:p2',
            }, ...(placement === 'retired' ? { controlServiceabilityV1: {
              v: 1, attachmentId: 'retired-attachment', state: 'recoverable_unservable',
              observedAt: 1, retired: true,
            } } : {}) },
          }),
        }),
        currentMachineId: 'this-machine', currentMachineHost: 'this-host',
        localAttachmentInfo: null, insideTmux: false,
      });
      if (placement === 'local') {
        expect(result).toMatchObject({ eligible: true, attachStrategy: 'terminal_host',
          terminal: { mode: 'herdr', herdr: { paneId: 'w1:p2' } } });
      } else expect(result).toMatchObject({ eligible: false, reasonCode: 'inactive' });
    },
  );
});
