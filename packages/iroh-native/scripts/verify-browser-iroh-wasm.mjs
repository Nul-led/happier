#!/usr/bin/env node
// Lane 06 A7.1 / I10 browser-Iroh feasibility gate.
//
// This proves the repository-owned browser seam empirically against the exact
// pinned Iroh dependency (`iroh = "=1.1.0"`):
//
//   1. the shared `happier-iroh-core` transport rules compile for
//      `wasm32-unknown-unknown` (no native TCP/loopback modules);
//   2. the `happier-iroh-wasm` browser binding compiles for that target and
//      generates a real `wasm-bindgen` boundary;
//   3. the browser binding never reaches for ambient n0 discovery or default
//      relays, and never re-declares relay/ALPN/endpoint rules that
//      `happier-iroh-core` already owns; and
//   4. the produced artifact sizes are measured rather than assumed.
//
// Item 3 is a source hygiene deny-list over named forbidden APIs, not a claim
// about Rust semantics. Behavioural invariants — the dial-only inbound role in
// particular — are proven by the crates' own tests, the wasm32 compile-time
// assertion this gate builds, and the live gate, never by parsing source shape.
//
// It deliberately does NOT activate production web routing (I11–I13).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rustDir = join(packageDir, 'rust');

export const WASM_TARGET = 'wasm32-unknown-unknown';
export const WASM_CRATE = 'happier-iroh-wasm';
export const CORE_CRATE = 'happier-iroh-core';

/**
 * Iroh 1.1.0 vocabulary that attaches ambient Number-0 infrastructure: the `N0`
 * builder preset, the default/staging relay maps, and the DNS/pkarr address
 * lookup services. A7 forbids all of them for the browser carrier, which may
 * only use explicitly supplied descriptor relay URLs.
 */
export const AMBIENT_DISCOVERY_PATTERNS = [
  { pattern: 'presets::N0', why: 'n0 default preset attaches ambient relays and DNS discovery' },
  { pattern: 'RelayMode::Default', why: 'n0 production relay map' },
  { pattern: 'RelayMode::Staging', why: 'n0 staging relay map' },
  { pattern: 'address_lookup', why: 'ambient address-lookup/discovery service' },
  { pattern: 'PkarrPublisher', why: 'ambient pkarr publication' },
  { pattern: 'PkarrResolver', why: 'ambient pkarr resolution' },
  { pattern: 'DnsAddressLookup', why: 'ambient DNS discovery' },
  { pattern: 'N0_DNS', why: 'n0 DNS defaults' },
];

/**
 * Facts owned by `happier-iroh-core`. The browser binding consumes them; a
 * second copy in the wasm crate would be a transport split-brain, so their
 * appearance there is a gate failure even when the value happens to match.
 */
export const CORE_OWNED_PATTERNS = [
  { pattern: 'RelayMode::', why: 'relay-mode selection is owned by RelaySelection in happier-iroh-core' },
  { pattern: 'presets::', why: 'endpoint preset selection is owned by IrohEndpoint::bind' },
  { pattern: 'Endpoint::builder', why: 'endpoint construction is owned by IrohEndpoint::bind' },
  { pattern: 'happier/home-tunnel', why: 'ALPN literals are owned by happier-iroh-core::HOME_TUNNEL_ALPN' },
  { pattern: 'happier/machine', why: 'ALPN literals are owned by happier-iroh-core::MACHINE_ALPN' },
];

/**
 * Scans browser-binding sources for forbidden ambient-discovery usage and for
 * duplicated core-owned transport rules. `sources` is `{ file, text }[]`.
 * Comment lines are ignored so the crate can explain why a rule exists.
 */
export function findForbiddenUsages(sources, groups = [
  { kind: 'ambient-discovery', patterns: AMBIENT_DISCOVERY_PATTERNS },
  { kind: 'core-owned', patterns: CORE_OWNED_PATTERNS },
]) {
  const violations = [];
  for (const { file, text } of sources) {
    const lines = String(text).split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\/\*|\*)/u.test(line)) return;
      for (const group of groups) {
        for (const { pattern, why } of group.patterns) {
          if (line.includes(pattern)) {
            violations.push({ kind: group.kind, file, line: index + 1, pattern, why });
          }
        }
      }
    });
  }
  return violations;
}

/**
 * Ambient discovery is forbidden on every target, so the shared core is scanned
 * for it as well — but only for it: the core legitimately owns the endpoint
 * builder, relay mode, and ALPN literals the browser binding must not restate.
 *
 * The browser's dial-only inbound behaviour is deliberately NOT checked from
 * source text. This gate cannot re-derive Rust `cfg` reachability, and the
 * invariant already has three real proofs:
 *
 *   * `happier-iroh-core`'s `InboundAlpnRole` tests, which assert that a
 *     dial-only endpoint advertises nothing while a dispatched one advertises
 *     both ALPNs;
 *   * the compile-time assertion in `happier-iroh-wasm` that the browser build
 *     target resolves to `InboundAlpnRole::DialOnly`, enforced by the wasm32
 *     build this gate runs; and
 *   * the live gate's real native-to-browser inbound handshake, which must be
 *     rejected rather than served or parked.
 */
export const AMBIENT_DISCOVERY_GROUP = [
  { kind: 'ambient-discovery', patterns: AMBIENT_DISCOVERY_PATTERNS },
];

/** Collects every `.rs` source under a crate directory as `{ file, text }`. */
export function collectRustSources(crateDir) {
  const sources = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'target') continue;
      const full = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.name.endsWith('.rs')) sources.push({ file: rel, text: readFileSync(full, 'utf8') });
    }
  };
  walk(crateDir, '');
  return sources;
}

/** The canonical shared endpoint/relay/ALPN owner the browser binding consumes. */
export function collectSharedCoreSources() {
  return collectRustSources(join(rustDir, CORE_CRATE, 'src'));
}

/** Measured artifact facts. No thresholds are asserted; sizes are reported. */
export function measureArtifacts(files) {
  return files.map(({ label, path }) => {
    const bytes = readFileSync(path);
    return {
      label,
      path,
      bytes: bytes.byteLength,
      gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    };
  });
}

function run(command, args, cwd) {
  process.stdout.write(`$ ${command} ${args.join(' ')}\n`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

/**
 * The one browser-artifact build owner: contract scan, wasm32 build, and
 * `wasm-bindgen` generation. The live Chromium gate reuses this rather than
 * repeating the build commands.
 */
export function buildBrowserIrohWasm() {
  const wasmCrateDir = join(rustDir, WASM_CRATE);
  if (!existsSync(join(wasmCrateDir, 'Cargo.toml'))) {
    throw new Error(
      `missing browser Iroh seam: ${join(wasmCrateDir, 'Cargo.toml')} does not exist. ` +
        'Lane 06 I10 requires a repository-owned wasm binding over happier-iroh-core.',
    );
  }

  // The browser binding's own rules, and the shared core that actually owns the
  // endpoint/relay/preset/ALPN decisions the browser inherits.
  const violations = [
    ...findForbiddenUsages(collectRustSources(join(wasmCrateDir, 'src'))),
    ...findForbiddenUsages(collectSharedCoreSources(), AMBIENT_DISCOVERY_GROUP),
  ];
  if (violations.length > 0) {
    const detail = violations
      .map((v) => `${v.file}:${v.line} [${v.kind}] ${v.pattern} — ${v.why}`)
      .join('\n  ');
    throw new Error(`browser binding violates the A7 transport contract:\n  ${detail}`);
  }

  // The shared core must build for the browser target without its native
  // TCP/loopback modules.
  run('cargo', ['check', '-p', CORE_CRATE, '--target', WASM_TARGET], rustDir);

  run('cargo', ['build', '--release', '-p', WASM_CRATE, '--target', WASM_TARGET], rustDir);

  const rawWasm = join(rustDir, 'target', WASM_TARGET, 'release', 'happier_iroh_wasm.wasm');
  if (!existsSync(rawWasm)) throw new Error(`missing wasm artifact: ${rawWasm}`);

  const outDir = join(rustDir, 'target', 'browser-wasm-gate');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  run('wasm-bindgen', ['--target', 'web', '--out-dir', outDir, rawWasm], rustDir);

  const bindgenWasm = join(outDir, 'happier_iroh_wasm_bg.wasm');
  const bindgenJs = join(outDir, 'happier_iroh_wasm.js');
  for (const path of [bindgenWasm, bindgenJs]) {
    if (!existsSync(path)) throw new Error(`wasm-bindgen did not generate ${path}`);
  }

  // The generated boundary must actually expose the probe API; a wasm module
  // with no JS boundary would prove nothing about browser reachability.
  const glue = readFileSync(bindgenJs, 'utf8');
  const requiredExports = [
    'HappierBrowserIrohProbe',
    'HappierBrowserIrohOpenCancellation',
    'endpointId',
    'openHomeTunnelStream',
    'openIncrementalHomeTunnelStream',
    // A7.4: the distinct machine/1 dial. It is a separate generated operation
    // rather than an ALPN parameter, so its absence is a packaging failure the
    // machine carrier would otherwise discover at dial time.
    'openIncrementalMachineStream',
    'streamRemoteEndpointId',
    'streamObservedPath',
    'readStream',
    'writeStream',
    'finishStreamWrite',
    'cancelStream',
    'closeStream',
    'advertisedInboundAlpns',
    // A7.2 endpoint configuration: the one endpoint adopts a second Home's
    // explicitly configured relays without rebinding.
    'applyRelayUrls',
    'liveConnectionTargets',
    'dialsStarted',
    'cancel',
    'close',
    // The implicit release. A JS caller may never call `close`, so the live gate
    // proves that this generated entry point is terminal custody too.
    'free',
  ];
  const missing = requiredExports.filter((name) => !glue.includes(name));
  if (missing.length > 0) {
    throw new Error(`generated wasm-bindgen boundary is missing: ${missing.join(', ')}`);
  }

  const measurements = measureArtifacts([
    { label: 'wasm32 release (raw)', path: rawWasm },
    { label: 'wasm-bindgen wasm', path: bindgenWasm },
    { label: 'wasm-bindgen js glue', path: bindgenJs },
  ]);
  const generated = readdirSync(outDir).map((name) => ({
    name,
    bytes: statSync(join(outDir, name)).size,
  }));

  return { outDir, rawWasm, bindgenWasm, bindgenJs, measurements, generated };
}

export function verifyBrowserIrohWasm() {
  // Host contract tests for the browser binding's own rules (relay-only,
  // explicit relay URLs, canonical ALPN identity).
  run('cargo', ['test', '-p', WASM_CRATE], rustDir);

  const built = buildBrowserIrohWasm();

  process.stdout.write(
    `\nbrowser-iroh-wasm gate: PASS\n${JSON.stringify(
      { target: WASM_TARGET, measurements: built.measurements, generated: built.generated },
      null,
      2,
    )}\n`,
  );
  return built;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verifyBrowserIrohWasm();
}
