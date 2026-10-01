import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredCredentials } from '@/persistence';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { registerTerminalEnrollmentMachine } from './persistTerminalEnrollmentCredential';

const {
  apiCreate,
  ensureMachineId,
  ensureMachineRegistered,
  observedOrigins,
} = vi.hoisted(() => ({
  apiCreate: vi.fn(),
  ensureMachineId: vi.fn(),
  ensureMachineRegistered: vi.fn(),
  observedOrigins: [] as string[],
}));

vi.mock('@/api/api', () => ({
  ApiClient: { create: apiCreate },
}));

vi.mock('@/api/machine/ensureMachineRegistered', () => ({
  ensureMachineRegistered,
}));

vi.mock('@/ui/auth', () => ({
  ensureMachineIdForCredentials: ensureMachineId,
}));

vi.mock('@/persistence', () => ({
  writeCredentialsDataKey: vi.fn(),
  writeCredentialsTokenOnly: vi.fn(),
}));

vi.mock('@/daemon/machine/metadata', () => ({
  initialMachineMetadata: {},
}));

describe('registerTerminalEnrollmentMachine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observedOrigins.length = 0;
    ensureMachineId.mockImplementation(async () => {
      observedOrigins.push(resolveServerHttpBaseUrl());
      return { machineId: 'machine-from-credentials' };
    });
    apiCreate.mockImplementation(async () => {
      observedOrigins.push(resolveServerHttpBaseUrl());
      return {};
    });
    ensureMachineRegistered.mockImplementation(async () => {
      observedOrigins.push(resolveServerHttpBaseUrl());
      return { machineId: 'registered-machine' };
    });
  });

  it('uses the acquired runtime origin for every registration step', async () => {
    const credentials = {
      token: 'terminal-token',
      encryption: null,
    } satisfies StoredCredentials;

    await expect(registerTerminalEnrollmentMachine(
      credentials,
      'http://127.0.0.1:48123',
    )).resolves.toBe('registered-machine');

    expect(observedOrigins).toEqual([
      'http://127.0.0.1:48123',
      'http://127.0.0.1:48123',
      'http://127.0.0.1:48123',
    ]);
    expect(apiCreate).toHaveBeenCalledWith(credentials);
    expect(ensureMachineRegistered).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-from-credentials',
      caller: 'auth.wait',
    }));
  });
});
