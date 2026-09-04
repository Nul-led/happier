import tweetnacl from 'tweetnacl';

import { ApiClient } from '@/api/api';
import { ensureMachineRegistered } from '@/api/machine/ensureMachineRegistered';
import { initialMachineMetadata } from '@/daemon/machine/metadata';
import {
  writeCredentialsDataKey,
  writeCredentialsTokenOnly,
  type StoredCredentials,
} from '@/persistence';
import type { OpenTerminalProvisioningResponseResult } from '@/auth/terminalProvisioningResponse';
import { ensureMachineIdForCredentials } from '@/ui/auth';

export async function persistTerminalEnrollmentCredential(params: Readonly<{
  token: string;
  opened: OpenTerminalProvisioningResponseResult;
}>): Promise<Readonly<{
  credentials: StoredCredentials;
  encryptionType: 'dataKey' | 'tokenOnly';
}>> {
  if (params.opened.type === 'dataKey') {
    const machineKey = params.opened.key;
    const publicKey = tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey;
    await writeCredentialsDataKey({ publicKey, machineKey, token: params.token });
    return {
      credentials: {
        token: params.token,
        encryption: { type: 'dataKey', publicKey, machineKey },
      },
      encryptionType: 'dataKey',
    };
  }

  await writeCredentialsTokenOnly({ token: params.token });
  return {
    credentials: { token: params.token, encryption: null },
    encryptionType: 'tokenOnly',
  };
}

export async function registerTerminalEnrollmentMachine(
  credentials: StoredCredentials,
): Promise<string> {
  const { machineId } = await ensureMachineIdForCredentials(credentials);
  const api = await ApiClient.create(credentials);
  const registered = await ensureMachineRegistered({
    api,
    machineId,
    metadata: initialMachineMetadata,
    caller: 'auth.wait',
  });
  return registered.machineId;
}
