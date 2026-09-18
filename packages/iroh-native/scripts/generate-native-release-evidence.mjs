#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTICE_NAME = 'THIRD-PARTY-NOTICES.txt';
const SBOM_NAME = 'sbom.cdx.json';

/**
 * Filenames Cargo crates conventionally use for the texts a redistributor has
 * to carry: the licence itself and the attribution files MIT/Apache-2.0 style
 * licences require alongside it. Matching by convention is what `cargo` and
 * every licence scanner do, because a `.crate` archive carries no index of
 * them; `Cargo.toml`'s `license-file` is added on top when a package names one.
 */
const LICENSE_FILE_PATTERN = /^(LICEN[CS]E|COPYING|COPYRIGHT|NOTICE|UNLICENSE|AUTHORS)([-_.].*)?$/iu;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCargoLockString(raw, field) {
  const match = raw.match(new RegExp(`^${field}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")$`, 'mu'));
  return match ? JSON.parse(match[1]) : null;
}

function parseCargoLock(lockfile) {
  const entries = new Map();
  for (const block of lockfile.split(/^\[\[package\]\]\s*$/mu).slice(1)) {
    const name = parseCargoLockString(block, 'name');
    const version = parseCargoLockString(block, 'version');
    const source = parseCargoLockString(block, 'source');
    const checksum = parseCargoLockString(block, 'checksum');
    if (!name || !version) continue;
    const key = JSON.stringify([name, version, source]);
    if (entries.has(key)) {
      throw new Error(`Cargo.lock contains an ambiguous package identity: ${name} ${version}`);
    }
    entries.set(key, { name, version, source, checksum });
  }
  return entries;
}

function packageReference(pkg) {
  const source = pkg.source ?? 'workspace';
  return `pkg:cargo/${encodeURIComponent(pkg.name)}@${encodeURIComponent(pkg.version)}?source=${encodeURIComponent(source)}`;
}

function packageSource(pkg) {
  return pkg.repository || pkg.source || 'workspace';
}

function assertMetadataShape(metadata) {
  if (!metadata || !Array.isArray(metadata.packages) || !Array.isArray(metadata.resolve?.nodes)) {
    throw new Error('cargo metadata returned an invalid resolved package graph');
  }
}

/**
 * Reads the licence and NOTICE texts each locked package actually distributes.
 *
 * `cargo metadata` resolves every package to the `Cargo.toml` of its extracted
 * source, so the texts live next to it. `listDir`/`readText` are the filesystem
 * boundary; they are injected so the collection itself stays deterministic and
 * testable. A package directory that cannot be listed, or a named licence file
 * that is absent, contributes nothing rather than failing: the caller reports
 * the packages without distributed text explicitly.
 */
export function collectCargoLicenseTexts({
  metadata,
  listDir = (dir) => readdirSync(dir),
  readText = (path) => readFileSync(path, 'utf8'),
}) {
  assertMetadataShape(metadata);
  const resolvedIds = new Set(metadata.resolve.nodes.map((node) => node.id));
  const texts = new Map();
  for (const pkg of metadata.packages) {
    if (!resolvedIds.has(pkg.id) || typeof pkg.manifest_path !== 'string') continue;
    const packageDir = pkg.manifest_path.slice(
      0,
      Math.max(pkg.manifest_path.lastIndexOf('/'), pkg.manifest_path.lastIndexOf('\\')),
    );

    let entries = [];
    try {
      entries = listDir(packageDir);
    } catch {
      entries = [];
    }
    const names = new Set(entries.filter((name) => LICENSE_FILE_PATTERN.test(name)));
    if (typeof pkg.license_file === 'string' && pkg.license_file.trim()) {
      names.add(pkg.license_file.trim());
    }

    const files = [];
    for (const name of [...names].sort()) {
      let text;
      try {
        text = readText(`${packageDir}/${name}`);
      } catch {
        continue;
      }
      // `--check` compares exact bytes, so a CRLF checkout of a first-party
      // licence must not produce different evidence than an LF one.
      files.push({ name, text: text.replace(/\r\n/gu, '\n') });
    }
    if (files.length > 0) texts.set(pkg.id, files);
  }
  return texts;
}

export function createIrohNativeReleaseEvidence({ metadata, lockfile, licenseTexts = new Map() }) {
  assertMetadataShape(metadata);
  const lockedPackages = parseCargoLock(lockfile);
  const resolvedIds = new Set(metadata.resolve.nodes.map((node) => node.id));
  const packages = metadata.packages
    .filter((pkg) => resolvedIds.has(pkg.id))
    .map((pkg) => {
      const lock = lockedPackages.get(JSON.stringify([pkg.name, pkg.version, pkg.source ?? null]));
      if (!lock) {
        throw new Error(`resolved Cargo package is absent from Cargo.lock: ${pkg.name} ${pkg.version}`);
      }
      if (pkg.source?.startsWith('registry+') && !lock.checksum) {
        throw new Error(`registry Cargo package has no locked checksum: ${pkg.name} ${pkg.version}`);
      }
      return { pkg, lock, ref: packageReference(pkg) };
    })
    .sort((left, right) => left.ref.localeCompare(right.ref));

  const references = new Map(packages.map((entry) => [entry.pkg.id, entry.ref]));
  if (references.size !== packages.length) {
    throw new Error('resolved Cargo graph contains duplicate package identities');
  }
  const lockfileSha256 = sha256(lockfile);
  const thirdParty = packages.filter(({ pkg }) => pkg.source !== null);
  const withoutText = thirdParty.filter(({ pkg }) => !(licenseTexts.get(pkg.id)?.length > 0));
  const noticeLines = [
    'Iroh native third-party notices',
    '',
    'Generated from Cargo.lock and `cargo metadata --locked --format-version 1`.',
    'Carries the licence and NOTICE texts each package distributes, for every',
    'native and WASM carrier built from this locked graph.',
    `Cargo.lock SHA-256: ${lockfileSha256}`,
    `Third-party packages: ${thirdParty.length}`,
    `Third-party packages without distributed licence text: ${withoutText.length}`,
    '',
  ];
  for (const { pkg, lock } of thirdParty) {
    noticeLines.push(`${pkg.name} ${pkg.version}`);
    noticeLines.push(`License: ${pkg.license || 'UNKNOWN'}`);
    noticeLines.push(`Source: ${packageSource(pkg)}`);
    if (lock.checksum) noticeLines.push(`Cargo checksum: ${lock.checksum}`);
    const files = licenseTexts.get(pkg.id) ?? [];
    if (files.length === 0) {
      noticeLines.push('No licence text is distributed with this package.');
    }
    for (const file of files) {
      const label = `${pkg.name} ${pkg.version} ${file.name}`;
      // The text is reproduced verbatim between delimiters that name the exact
      // package and file it came from, so the obligation it carries stays
      // attributable and a reader never has to guess which crate it belongs to.
      noticeLines.push(`----- BEGIN ${label} -----`);
      noticeLines.push(file.text.endsWith('\n') ? file.text.slice(0, -1) : file.text);
      noticeLines.push(`----- END ${label} -----`);
    }
    noticeLines.push('');
  }

  const components = packages.map(({ pkg, lock, ref }) => {
    const source = pkg.repository || pkg.source;
    return {
      type: 'library',
      'bom-ref': ref,
      name: pkg.name,
      version: pkg.version,
      ...(pkg.license ? { licenses: [{ expression: pkg.license }] } : {}),
      ...(lock.checksum ? { hashes: [{ alg: 'SHA-256', content: lock.checksum }] } : {}),
      ...(source ? { externalReferences: [{ type: 'distribution', url: source }] } : {}),
      properties: [
        { name: 'happier:cargo-source', value: pkg.source ?? 'workspace' },
      ],
    };
  });
  const dependencies = metadata.resolve.nodes
    .filter((node) => references.has(node.id))
    .map((node) => ({
      ref: references.get(node.id),
      dependsOn: node.dependencies
        .map((id) => references.get(id))
        .filter(Boolean)
        .sort(),
    }))
    .sort((left, right) => left.ref.localeCompare(right.ref));
  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      tools: [{ vendor: 'Happier', name: 'iroh-native Cargo release evidence' }],
      properties: [
        { name: 'happier:cargo-lock-sha256', value: lockfileSha256 },
        { name: 'happier:cargo-metadata-command', value: 'cargo metadata --locked --format-version 1' },
      ],
    },
    components,
    dependencies,
  };

  return {
    lockfileSha256,
    notices: `${noticeLines.join('\n')}\n`,
    sbom: `${JSON.stringify(sbom, null, 2)}\n`,
  };
}

async function assertExactEvidenceFile(path, expected) {
  let actual;
  try {
    actual = await readFile(path, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`missing native release evidence: ${path}`);
    }
    throw error;
  }
  if (actual !== expected) {
    throw new Error(`stale native release evidence: ${path}`);
  }
}

export async function writeOrCheckIrohNativeReleaseEvidence({ outputDir, evidence, check }) {
  const noticesPath = join(outputDir, NOTICE_NAME);
  const sbomPath = join(outputDir, SBOM_NAME);
  if (check) {
    await assertExactEvidenceFile(noticesPath, evidence.notices);
    await assertExactEvidenceFile(sbomPath, evidence.sbom);
    return;
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(noticesPath, evidence.notices, 'utf8');
  await writeFile(sbomPath, evidence.sbom, 'utf8');
}

function parseArgs(argv) {
  const values = new Map();
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      check = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    values.set(arg, value);
    index += 1;
  }
  return { values, check };
}

export function resolveIrohNativeManifestPath(packageRoot) {
  return join(packageRoot, 'rust', 'Cargo.toml');
}

/**
 * The one evidence producer for every carrier built from this Cargo workspace.
 *
 * The workspace lockfile resolves the native addon, the mobile static
 * libraries, and the browser WASM boundary together, so a single locked graph
 * answers for all of them. Callers stage the same bytes; they do not compute a
 * per-platform inventory of their own.
 */
export async function generateIrohNativeReleaseEvidence({ packageRoot, manifestPath } = {}) {
  const root = resolve(packageRoot || fileURLToPath(new URL('..', import.meta.url)));
  const manifest = resolve(manifestPath || resolveIrohNativeManifestPath(root));
  const cargo = spawnSync(
    'cargo',
    ['metadata', '--locked', '--format-version', '1', '--manifest-path', manifest],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (cargo.status !== 0) {
    throw new Error(`cargo metadata --locked failed: ${String(cargo.stderr || cargo.error || '').trim()}`);
  }
  const metadata = JSON.parse(cargo.stdout);
  const lockfile = await readFile(join(dirname(manifest), 'Cargo.lock'), 'utf8');
  return createIrohNativeReleaseEvidence({
    metadata,
    lockfile,
    licenseTexts: collectCargoLicenseTexts({ metadata }),
  });
}

async function main() {
  const { values, check } = parseArgs(process.argv.slice(2));
  const packageRoot = resolve(values.get('--package-root') || fileURLToPath(new URL('..', import.meta.url)));
  const manifestPath = resolve(values.get('--manifest-path') || resolveIrohNativeManifestPath(packageRoot));
  const outputDir = resolve(values.get('--output-dir') || join(packageRoot, 'release-evidence'));
  const evidence = await generateIrohNativeReleaseEvidence({ packageRoot, manifestPath });
  await writeOrCheckIrohNativeReleaseEvidence({ outputDir, evidence, check });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
