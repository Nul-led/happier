import { describe, expect, it } from 'vitest';

import { decodeCodexAppServerGoal } from './goalCodec.js';

// Codex mints the goal's thread id; it is the vendor reference Happier sends
// back for goal control, so a trimming codec addresses a different thread.
const EXACT_PROVIDER_SESSION_ID = '  provider\nses/AB+cd==  ';

describe('decodeCodexAppServerGoal', () => {
  it('keeps the vendor thread reference byte-exact while trimming the display title', () => {
    const decoded = decodeCodexAppServerGoal({
      backendId: 'codex-app-server',
      goal: {
        threadId: EXACT_PROVIDER_SESSION_ID,
        objective: '  Ship the lane  ',
        status: 'active',
        updatedAt: 1_768_000_100,
      },
    });

    expect(decoded).toMatchObject({
      id: `goal:${EXACT_PROVIDER_SESSION_ID}`,
      vendorRef: EXACT_PROVIDER_SESSION_ID,
      title: 'Ship the lane',
    });
  });

  it('rejects a blank vendor thread reference', () => {
    expect(decodeCodexAppServerGoal({
      backendId: 'codex-app-server',
      goal: {
        threadId: ' \n\t ',
        objective: 'Ship the lane',
        status: 'active',
        updatedAt: 1_768_000_100,
      },
    })).toBeNull();
  });
});
