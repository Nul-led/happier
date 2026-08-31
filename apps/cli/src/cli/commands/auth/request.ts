import { randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import axios from 'axios';
import tweetnacl from 'tweetnacl';

import { encodeBase64, encodeBase64Url } from '@/api/encryption';
import { writeJsonStdout } from '@/cli/output/jsonEnvelope';
import { configuration } from '@/configuration';
import { applyServerSelectionFromArgs } from '@/server/serverSelection';
import { fetchServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { buildConfigureServerLinks, buildTerminalConnectLinks } from '@happier-dev/cli-common/links';
import {
  createTerminalPairingAuthentication,
  readTerminalPairingRequirement,
} from '@/auth/terminalProvisioningResponse';
import {
  ensureProtectedLocalStateDirectory,
  writeProtectedLocalStateFileAtomic,
} from '@/utils/fs/protectedLocalState';

const PENDING_AUTH_STATE_PROTECTION = { authority: 'owned' } as const;

function sha256Base64Url(input: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(input)).digest('base64url');
}

function pendingAuthStateDir(): string {
  return join(configuration.activeServerDir, 'auth', 'pending');
}

function pendingAuthStatePath(publicKey: Uint8Array): string {
  const publicKeyHex = createHash('sha256').update(Buffer.from(publicKey)).digest('hex').slice(0, 24);
  return join(pendingAuthStateDir(), `${publicKeyHex}.json`);
}

export async function handleAuthRequest(args: string[]): Promise<void> {
  args = await applyServerSelectionFromArgs(args);

  const json = args.includes('--json');
  if (!json) {
    console.error('Missing required flag: --json');
    process.exit(2);
  }

  const featuresSnapshot = await fetchServerFeaturesSnapshot({ serverUrl: configuration.apiServerUrl });
  const serverIdentityId = featuresSnapshot.status === 'ready'
    ? featuresSnapshot.features.capabilities.serverIdentity.serverIdentityId?.trim() ?? ''
    : '';
  if (!serverIdentityId) {
    throw new Error(
      `Unable to verify the selected Home identity at ${configuration.apiServerUrl}; `
      + 'the terminal authentication request was not created.',
    );
  }

  const secret = new Uint8Array(randomBytes(32));
  const keypair = tweetnacl.box.keyPair.fromSecretKey(secret);
  const claimSecret = new Uint8Array(randomBytes(32));
  const claimSecretB64Url = Buffer.from(claimSecret).toString('base64url');
  const claimSecretHash = sha256Base64Url(claimSecret);
  const pairingRequirement = readTerminalPairingRequirement();
  const pairing = createTerminalPairingAuthentication({
    nowMs: Date.now(),
    randomBytes: (length) => new Uint8Array(randomBytes(length)),
  });
  const pairingSecretB64Url = Buffer.from(pairing.secret).toString('base64url');

  const publicKeyB64 = encodeBase64(keypair.publicKey);
  await axios.post(`${configuration.apiServerUrl}/v1/auth/request`, {
    publicKey: publicKeyB64,
    supportsV2: true,
    claimSecretHash,
  });

  const statePath = pendingAuthStatePath(keypair.publicKey);
  await ensureProtectedLocalStateDirectory(pendingAuthStateDir(), PENDING_AUTH_STATE_PROTECTION);
  await writeProtectedLocalStateFileAtomic(
    statePath,
    JSON.stringify(
      {
        publicKey: publicKeyB64,
        secretKey: encodeBase64(keypair.secretKey),
        claimSecret: claimSecretB64Url,
        serverIdentityId,
        pairingSecret: pairingSecretB64Url,
        pairingCreatedAtMs: pairing.createdAtMs,
        pairingExpiresAtMs: pairing.expiresAtMs,
        supportsTokenOnly: true,
        ...(pairingRequirement ? { pairingRequirement } : {}),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    PENDING_AUTH_STATE_PROTECTION,
  );

  const publicKeyB64Url = encodeBase64Url(keypair.publicKey);
  const configureLinks = buildConfigureServerLinks({
    webappUrl: configuration.webappUrl,
    serverUrl: configuration.publicServerUrl,
  });
  const terminalLinks = buildTerminalConnectLinks({
    webappUrl: configuration.webappUrl,
    serverUrl: configuration.publicServerUrl,
    publicKeyB64Url,
    serverIdentityId,
    pairing: {
      secretB64Url: pairingSecretB64Url,
      createdAtMs: pairing.createdAtMs,
      expiresAtMs: pairing.expiresAtMs,
    },
    supportsTokenOnly: true,
  });

  await writeJsonStdout({
    publicKey: publicKeyB64,
    publicKeyB64Url,
    claimSecret: claimSecretB64Url,
    serverIdentityId,
    pairing: {
      secretB64Url: pairingSecretB64Url,
      createdAtMs: pairing.createdAtMs,
      expiresAtMs: pairing.expiresAtMs,
    },
    supportsTokenOnly: true,
    pairingRequirement: pairingRequirement ?? 'compatible',
    serverId: configuration.activeServerId,
    serverUrl: configuration.serverUrl,
    publicServerUrl: configuration.publicServerUrl,
    webappUrl: configuration.webappUrl,
    links: {
      configureWebUrl: configureLinks.webUrl,
      configureMobileUrl: configureLinks.mobileUrl,
      webUrl: terminalLinks.webUrl,
      mobileUrl: terminalLinks.mobileUrl,
    },
    stateFile: statePath,
  });
}
