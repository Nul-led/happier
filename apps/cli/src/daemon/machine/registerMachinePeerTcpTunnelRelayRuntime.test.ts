import { FeaturesResponseSchema } from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import { registerMachinePeerTcpTunnelRelayRuntime } from './registerMachinePeerTcpTunnelRelayRuntime';

function createFeatures(enabled: boolean) {
  return FeaturesResponseSchema.parse({
    features: {
      machines: {
        enabled: true,
        tunnel: { enabled: true, directPeer: { enabled: false }, serverRouted: { enabled } },
      },
    },
    capabilities: {
      machines: {
        peerMediation: {
          grantSigningKeys: [{ keyId: 'key-1', publicKey: 'public-key-1', expiresAt: 1_000 }],
        },
      },
    },
  });
}

describe('machine peer TCP tunnel relay runtime composition', () => {
  it('uses the published capability and trust roots, exact identity, and disposes subscription plus tunnels', async () => {
    const unsubscribe = vi.fn();
    const disposeTerminator = vi.fn(async () => undefined);
    const registerTerminator = vi.fn(() => ({ dispose: disposeTerminator }));
    const resolveProviderBrokerApplicationTarget = vi.fn();
    const features = createFeatures(true);
    const runtime = registerMachinePeerTcpTunnelRelayRuntime({
      accountId: 'runner-account',
      machineId: 'runner-machine',
      serverFeatures: features,
      nowMs: () => 100,
      eventPort: {
        subscribe: () => unsubscribe,
        emit: vi.fn(),
      },
      resolveProviderBrokerApplicationTarget,
      dependencies: { registerTerminator },
    });

    expect(runtime).not.toBeNull();
    expect(registerTerminator).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'runner-account',
      machineId: 'runner-machine',
      resolveProviderBrokerApplicationTarget,
    }));
    await runtime?.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(disposeTerminator).toHaveBeenCalledOnce();
  });

  it('fails closed when the Home does not publish a usable enabled capability', () => {
    const registerTerminator = vi.fn();
    const features = createFeatures(false);
    expect(registerMachinePeerTcpTunnelRelayRuntime({
      accountId: 'runner-account',
      machineId: 'runner-machine',
      serverFeatures: features,
      nowMs: () => 100,
      eventPort: { subscribe: vi.fn(), emit: vi.fn() },
      dependencies: { registerTerminator },
    })).toBeNull();
    expect(registerTerminator).not.toHaveBeenCalled();
  });
});
