// Lane 06 amendment A7.3/A7.4 — the LOADED PRODUCTION PAGE SEAM.
//
// This is the reusable half of the A7.3 gate: a page built by the canonical
// Metro/Expo web bundling owner that carries the real browser Iroh Home
// carrier, the real `serverFetch`, and the real Socket.IO owner into a real
// Chromium, and runs them there.
//
// It deliberately stops short of the A7.3 completion journey. That journey
// needs a real stock relay and real Home acceptors, which only the native
// `packages/iroh-native` test-addon fixture can supply
// (`forceRelayOnly`/`getTestRelayUrl` + `startHomeAcceptor`); that fixture is
// not wired here. What this seam does prove is the part that was actually
// blocked before: the production owners cannot be reached by the existing
// esbuild proof page, and now they can be reached, bundled and executed in a
// browser exactly as a production web export resolves them.
//
// Nothing here fakes a relay, a Home, a grant, or an admission decision.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProductionProofPageBundle } from './buildProductionProofPageBundle.mjs';

const toolsIrohDir = dirname(fileURLToPath(import.meta.url));
const PAGE_ENTRY = resolve(toolsIrohDir, 'productionCarrierSeamPage.ts');

/** The bundle name inside the proof's own web output root. */
export const PRODUCTION_CARRIER_SEAM_BUNDLE = 'a73-production-carrier-seam.js';

/**
 * The production owners A7.3 names. Their presence in the emitted graph is what
 * makes this a seam over the app rather than over the proof's own code.
 */
export const REQUIRED_GRAPH_OWNERS = [
  'sources/sync/runtime/browserIroh/homeCarrier/browserHomeCarrierRuntime.ts',
  'sources/sync/runtime/browserIroh/homeCarrier/homeTunnelWebSocket.ts',
  'sources/sync/runtime/browserIroh/homeTunnelHttp.ts',
  'sources/sync/runtime/browserIroh/endpointClient.ts',
  'sources/sync/runtime/browserIroh/hostEligibility.ts',
  'sources/sync/http/client.ts',
  'sources/sync/api/session/connection/createSyncSocketTransport.ts',
  'sources/sync/domains/transfers/runtime/transferRuntime/plumbing/machineCarrierBrowserStream.ts',
];

/** The commands the loaded page must expose for the A7.3 journey to be drivable. */
const REQUIRED_PAGE_COMMANDS = [
  'acquireCarrier',
  'httpRequest',
  'openSocket',
  'readSocket',
  'emitSocket',
  'destroySocket',
  'releaseCarrier',
  'probeMachineCarrierSeam',
];

function bail(message) {
  throw new Error(message);
}

/** One Metro build of the page per web output root, shared by both stages. */
const builtBundles = new Map();

/**
 * Builds the page with the canonical Metro/Expo web bundling owner and checks
 * its emitted graph, once per output root.
 *
 * The graph check is the discriminating part: an entry that failed to pull the
 * production owners in proves nothing about them, so a page whose graph is
 * missing one is a hard failure rather than a finding. The A7.3 journey and the
 * loaded seam drive the SAME built page, so this must not be duplicated.
 */
export async function ensureProductionCarrierSeamBundle({ webOutputRoot }) {
  const existing = builtBundles.get(webOutputRoot);
  if (existing) return await existing;

  const pending = (async () => {
    const bundleFile = join(webOutputRoot, PRODUCTION_CARRIER_SEAM_BUNDLE);
    const built = await buildProductionProofPageBundle({ entryFile: PAGE_ENTRY, outFile: bundleFile });
    const missingOwners = REQUIRED_GRAPH_OWNERS.filter(
      (owner) => !built.graphFiles.some((file) => file.replace(/\\/gu, '/').endsWith(owner)),
    );
    if (missingOwners.length > 0) {
      bail(
        'the Metro-built proof page does not contain the production owners it must carry:\n  '
        + missingOwners.join('\n  '),
      );
    }
    return {
      ...built,
      report: {
        bytes: readFileSync(built.bundleFile).length,
        modules: built.graphFiles.length,
        productionOwnersInPageGraph: REQUIRED_GRAPH_OWNERS,
      },
    };
  })();
  builtBundles.set(webOutputRoot, pending);
  try {
    return await pending;
  } catch (error) {
    builtBundles.delete(webOutputRoot);
    throw error;
  }
}

/** Runs one page command and returns its JSON-safe reply. */
function command(page, name, argument) {
  return page.evaluate(
    ([commandName, commandArgument]) => window.__happierProductionCarrierSeam[commandName](commandArgument),
    [name, argument ?? null],
  );
}

/**
 * Builds the Metro page, checks its module graph, loads it in a real Chromium,
 * and exercises the one production call that needs no relay. Returns the report
 * and the failures it observed; the caller owns the exit status.
 */
export async function runProductionCarrierPageSeam({ webOutputRoot, openProofPage, pageErrors }) {
  const failures = [];
  const report = {};

  // 1. The canonical Metro/Expo web bundling owner builds the page and its
  //    emitted graph is checked against the production owners it must carry.
  const built = await ensureProductionCarrierSeamBundle({ webOutputRoot });
  report.pageBundle = { bytes: built.report.bytes, modules: built.report.modules };
  report.productionOwnersInPageGraph = built.report.productionOwnersInPageGraph;

  // 2. The page runs in a real Chromium: the bundle executes, and the
  //    production module graph initializes without a page error.
  const page = await openProofPage();
  const exposedCommands = await page.evaluate(() => Object.keys(window.__happierProductionCarrierSeam));
  report.exposedCommands = exposedCommands;
  const missingCommands = REQUIRED_PAGE_COMMANDS.filter((name) => !exposedCommands.includes(name));
  if (missingCommands.length > 0) {
    failures.push(`the loaded page is missing production commands: ${missingCommands.join(', ')}`);
  }

  // 3. The one production call that needs no relay: the A7.4 browser machine
  //    carrier. With no adopted server, credential, or target machine
  //    descriptor in this page it must return the production owner's own typed
  //    precondition failure — proof that the real owner ran here, and the exact
  //    statement of what a completed A7.4 gate still needs from a fixture.
  const machineSeam = await command(page, 'probeMachineCarrierSeam', {
    operationId: 'a74-loaded-seam-probe',
    machineId: 'machine-under-proof',
    maxBytes: 1024,
  });
  report.machineCarrierSeam = machineSeam;
  if (machineSeam?.ok !== false) {
    failures.push(
      `the A7.4 seam produced a lease without a signed grant or admission: ${JSON.stringify(machineSeam)}`,
    );
  }

  if (pageErrors.length > 0) {
    failures.push(`browser page errors: ${pageErrors.join(' | ')}`);
  }

  return { report, failures };
}
