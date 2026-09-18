#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const lockfiles = [
  'rust/Cargo.lock',
  '../../apps/ui/src-tauri/Cargo.lock',
];

function readPackageIdentity(relativePath, packageName) {
  const source = readFileSync(join(packageRoot, relativePath), 'utf8');
  const block = source.split(/\n\[\[package\]\]\n/u).find((candidate) => candidate.includes(`name = "${packageName}"`));
  if (!block) throw new Error(`${relativePath}: missing ${packageName} package`);
  const field = (name) => block.match(new RegExp(`^${name} = "([^"]+)"$`, 'mu'))?.[1];
  const identity = { version: field('version'), source: field('source'), checksum: field('checksum') };
  if (!identity.version || !identity.source || !identity.checksum) {
    throw new Error(`${relativePath}: ${packageName} version/source/checksum is incomplete`);
  }
  return identity;
}

function verifyPackageParity(packageName) {
  const identities = lockfiles.map((path) => ({ path, ...readPackageIdentity(path, packageName) }));
  const canonical = identities[0];
  for (const identity of identities.slice(1)) {
    for (const field of ['version', 'source', 'checksum']) {
      if (identity[field] !== canonical[field]) {
        throw new Error(`${identity.path}: ${packageName} ${field} ${identity[field]} does not match ${canonical.path} (${canonical[field]})`);
      }
    }
  }
  return canonical;
}

const canonical = verifyPackageParity('iroh');
const relay = verifyPackageParity('iroh-relay');

const dockerfile = readFileSync(join(packageRoot, '../../deploy/iroh-relay/Dockerfile'), 'utf8');
const relayVersion = dockerfile.match(/^ARG IROH_RELAY_VERSION=([^\s]+)$/mu)?.[1];
if (relay.version !== canonical.version) {
  throw new Error(`relay version ${relay.version} does not match core version ${canonical.version}`);
}
if (relayVersion !== relay.version || relay.source !== canonical.source) {
  throw new Error(`deploy/iroh-relay/Dockerfile: relay ${relayVersion ?? '<missing>'} does not match locked iroh-relay ${relay.version} from ${relay.source}`);
}

process.stdout.write(
  `Iroh parity: core=${canonical.version} ${canonical.source} ${canonical.checksum} ` +
  `relay=${relay.version} ${relay.source} ${relay.checksum}\n`,
);
