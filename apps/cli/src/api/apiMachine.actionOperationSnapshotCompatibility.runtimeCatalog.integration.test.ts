import { describe, expect, it, vi } from 'vitest';

import { emitActionOperationSnapshotV1 } from './apiMachine';

describe('Action operation snapshot producer compatibility', () => {
  it('emits exactly the immutable released 0.2.11 envelope once', () => {
    const emit = vi.fn();

    emitActionOperationSnapshotV1({
      socket: { emit },
      machineId: 'machine-1',
      ciphertext: 'sealed-snapshot',
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('action-operation-updated', {
      type: 'action-operation-updated',
      machineId: 'machine-1',
      content: { t: 'encrypted', c: 'sealed-snapshot' },
    });
  });
});
