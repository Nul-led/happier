#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const lockfiles = [
  'rust/Cargo.lock',
  '../../apps/ui/src-tauri/Cargo.lock',
];

function readIrohIdentity(relativePath) {
  const source = readFileSync(join(packageRoot, relativePath), 'utf8');
  const block = source.split(/\n\[\[package\]\]\n/u).find((candidate) => /^name = "iroh"$/mu.test(candidate));
  if (!block) throw new Error(`${relativePath}: missing iroh package`);
  const field = (name) => block.match(new RegExp(`^${name} = "([^"]+)"$`, 'mu'))?.[1];
  const identity = { version: field('version'), source: field('source'), checksum: field('checksum') };
  if (!identity.version || !identity.source || !identity.checksum) {
    throw new Error(`${relativePath}: iroh version/source/checksum is incomplete`);
  }
  return identity;
}

const identities = lockfiles.map((path) => ({ path, ...readIrohIdentity(path) }));
const canonical = identities[0];
for (const identity of identities.slice(1)) {
  for (const field of ['version', 'source', 'checksum']) {
    if (identity[field] !== canonical[field]) {
      throw new Error(`${identity.path}: iroh ${field} ${identity[field]} does not match ${canonical.path} (${canonical[field]})`);
    }
  }
}

const dockerfile = readFileSync(join(packageRoot, '../../deploy/iroh-relay/Dockerfile'), 'utf8');
const relayVersion = dockerfile.match(/^ARG IROH_RELAY_VERSION=([^\s]+)$/mu)?.[1];
if (relayVersion !== canonical.version) {
  throw new Error(`deploy/iroh-relay/Dockerfile: relay ${relayVersion ?? '<missing>'} does not match iroh ${canonical.version}`);
}

process.stdout.write(`Iroh parity: ${canonical.version} ${canonical.source} ${canonical.checksum}\n`);
