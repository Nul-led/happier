#!/usr/bin/env node
// Lane 06 amendment A7.2 — the real browser shared-endpoint proof.
//
// This proves the three A7.2 live-owner facts against the PACKAGED browser Iroh
// assets — the same `vendor/iroh/` files the web release build stages into its
// export output and serves — through the real SharedWorker → endpoint owner →
// wasm endpoint path:
//
//   1. two tabs share one endpoint ID over one worker;
//   2. a tab reload preserves the endpoint ID;
//   3. releasing one client does not stop the sibling.
//
// Reuses the existing browser proof infrastructure and canonical asset producer
// (`buildBrowserIrohAssets.mjs`). Chromium remains the required/default A7
// engine; `HAPPIER_IROH_PROOF_BROWSER=firefox|webkit` replays this same journey
// for cross-engine QA without creating another harness or product policy.
//
// The proof is about live-worker endpoint IDENTITY, not transport: the
// default relay URL is grammar-valid but need not be reachable, because the
// owner binds one endpoint for its worker lifetime and no stream is opened.
// Pass `--relay-url http://127.0.0.1:PORT` to run against a live local relay.
//
// `--production-page-seam` adds the A7.3/A7.4 LOADED SEAM stage: a second page,
// built by the canonical Metro/Expo web bundling owner, carrying the PRODUCTION
// browser Iroh Home carrier, `serverFetch`, Socket.IO owner, and machine
// carrier into a real Chromium. It is not the A7.3 completion journey — no
// relay, Home acceptor, grant, or admission is involved. See
// `runProductionCarrierPageSeam.mjs`.
//
// `--real-home-vertical` runs the A7.3 COMPLETION journey on that same page: the
// stock local relay and a real Home acceptor from the shared native fixture, an
// ingress-less Home, authenticated HTTP, a live Socket.IO update, reconnect
// after a carrier-acceptor restart, identity binding, cancellation, and release. See
// `runRealHomeVerticalJourney.mjs`.
//
// Usage:
//   node apps/ui/tools/iroh/runBrowserIrohSharedEndpointProof.mjs [--relay-url <url>]
//   node apps/ui/tools/iroh/runBrowserIrohSharedEndpointProof.mjs --production-page-seam
//   node apps/ui/tools/iroh/runBrowserIrohSharedEndpointProof.mjs --real-home-vertical
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

import {
  buildBrowserIrohAssets,
} from './buildBrowserIrohAssets.mjs';
import {
  formatBrowserIrohAssetVerification,
  verifyBrowserIrohAssets,
} from './browserIrohAssetPackaging.mjs';
import {
  PRODUCTION_CARRIER_SEAM_BUNDLE,
  runProductionCarrierPageSeam,
} from './runProductionCarrierPageSeam.mjs';
import { runBrowserMachineTransferJourney } from './runBrowserMachineTransferJourney.mjs';
import { runRealHomeVerticalJourney } from './runRealHomeVerticalJourney.mjs';

const toolsIrohDir = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(toolsIrohDir, '..', '..');
const PAGE_ENTRY = resolve(toolsIrohDir, 'sharedEndpointProofPage.ts');

/** Where the loaded production-carrier seam page is served from, inside the same output. */
const PRODUCTION_CARRIER_SEAM_PAGE_PATH = '/production-carrier-seam';
/**
 * How long the production seam page may take to load and initialize.
 *
 * The A7.2 page is a leaf esbuild bundle and loads instantly; the A7.3/A7.4 page
 * is the whole app graph built by Metro, and Chromium has to parse and execute
 * every byte of it. Playwright's 30s default is a harness assumption about page
 * size, not a product contract, so it is raised here rather than left to fail a
 * gate for a reason the amendment says nothing about. It stays bounded: a page
 * that never initializes is still a failure, not a hang.
 */
const PRODUCTION_CARRIER_SEAM_LOAD_TIMEOUT_MS = 180_000;

function bail(message) {
  throw new Error(message);
}


function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.ts': 'text/plain',
};

function serveFile(res, filePath) {
  const body = readFileSync(filePath);
  res.writeHead(200, {
    'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'content-length': body.length,
  });
  res.end(body);
}

/**
 * Serves the proof's own isolated web output root, so the worker URL the proof
 * connects to is exactly the packaged asset path production serves — without
 * the proof leaving assets in a source tree other build targets would inherit.
 */
function startStaticServer({ webOutputRoot, pages, harnessPath }) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    try {
      const page = pages.get(pathname);
      if (page !== undefined) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(page);
        return;
      }
      if (pathname === '/harness.js') {
        serveFile(response, harnessPath);
        return;
      }
      const relativePath = decodeURIComponent(pathname).replace(/^\/+/u, '');
      const filePath = normalize(join(webOutputRoot, relativePath));
      if (!filePath.startsWith(webOutputRoot + sep)) {
        response.writeHead(403).end();
        return;
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404).end();
        return;
      }
      serveFile(response, filePath);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  return server;
}

async function openTab(context, base, pageErrors) {
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(base, { waitUntil: 'load' });
  await connectClient(page, base);
  return page;
}

async function openProductionCarrierPage(context, url, pageErrors) {
  const page = await context.newPage();
  let rejectPageFailure;
  const pageFailure = new Promise((_resolve, reject) => { rejectPageFailure = reject; });
  page.on('pageerror', (error) => {
    const diagnostic = `pageerror: ${error.stack || String(error)}`;
    pageErrors.push(diagnostic);
    rejectPageFailure(new Error(diagnostic));
  });
  try {
    await page.goto(url, { waitUntil: 'load', timeout: PRODUCTION_CARRIER_SEAM_LOAD_TIMEOUT_MS });
    await Promise.race([
      page.waitForFunction(
        () => window.__happierProductionCarrierSeam !== undefined,
        undefined,
        { timeout: PRODUCTION_CARRIER_SEAM_LOAD_TIMEOUT_MS },
      ),
      pageFailure,
    ]);
  } catch (error) {
    const diagnostics = pageErrors.length > 0 ? pageErrors.join(' | ') : 'no page or console error was emitted';
    throw new Error(`production carrier page did not initialize: ${String(error)}; diagnostics: ${diagnostics}`);
  }
  return page;
}

async function connectClient(page, base) {
  await page.evaluate((origin) => {
    window.__happierIrohProofClient = window.__happierIrohProofConnect(origin);
  }, base);
}

async function acquireLease(page, relayUrl) {
  return page.evaluate(async (relay) => await window.__happierIrohProofClient.acquireLease([relay]), relayUrl);
}

async function releaseAll(page) {
  return page.evaluate(async () => await window.__happierIrohProofClient.releaseAll());
}

async function status(page) {
  return page.evaluate(async () => await window.__happierIrohProofClient.status());
}

/**
 * The proof's optional stages. Both are opt-in because each costs a full Metro
 * web build, and the real journey additionally costs a Rust addon build and a
 * live relay; the A7.2 identity proof stays exactly as cheap as it was.
 *
 * They are separate names on purpose: the loaded seam proves the production
 * owners are carried and run, the real journey proves the A7.3 completion
 * evidence. Neither may be reported as the other.
 */
export function parseProofModes(argv) {
  return {
    productionPageSeam: argv.includes('--production-page-seam'),
    realHomeVertical: argv.includes('--real-home-vertical'),
    machineTransferVertical: argv.includes('--machine-transfer-vertical'),
  };
}

const PROOF_BROWSER_ENGINES = new Set(['chromium', 'firefox', 'webkit']);

export function resolveProofBrowserEngine(value) {
  const engine = value ?? 'chromium';
  if (!PROOF_BROWSER_ENGINES.has(engine)) {
    throw new Error(`unsupported Playwright browser engine: ${engine}`);
  }
  return engine;
}

async function main() {
  const relayUrlIndex = process.argv.indexOf('--relay-url');
  const relayUrl = relayUrlIndex !== -1 ? String(process.argv[relayUrlIndex + 1]) : 'https://relay.happier.test';
  const { productionPageSeam, realHomeVertical, machineTransferVertical } = parseProofModes(process.argv.slice(2));

  // 1. The canonical producer: packaged SharedWorker + generated wasm boundary
  //    in an isolated web output root that belongs to this proof run alone,
  //    verified against its own manifest. The proof must never serve a stale or
  //    hand-made directory, and must never leave its assets behind in a source
  //    tree a later Tauri or native export would copy.
  const stagingDir = mkdtempSync(join(tmpdir(), 'happier-iroh-proof-'));
  const keepProofOutput = process.env.HAPPIER_IROH_PROOF_KEEP_OUTPUT === '1';
  const webOutputRoot = join(stagingDir, 'web-output');
  mkdirSync(webOutputRoot, { recursive: true });
  const harnessPath = join(stagingDir, 'harness.js');
  let server;
  try {
    const packaged = await buildBrowserIrohAssets({ outputRoot: webOutputRoot });
    const verification = verifyBrowserIrohAssets({ outputRoot: webOutputRoot });
    if (verification.status !== 'ok') {
      bail(formatBrowserIrohAssetVerification(verification));
    }

    // 2. The page harness, bundled with the same esbuild the worker bundle uses,
    //    importing the real protocol parser and asset URL rule.
    await esbuild.build({
      entryPoints: [PAGE_ENTRY],
      outfile: harnessPath,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      sourcemap: false,
      legalComments: 'none',
      minify: false,
      absWorkingDir: uiDir,
      tsconfig: join(uiDir, 'tsconfig.json'),
    });

    const pages = new Map([
      ['/', [
        '<!doctype html>',
        '<meta charset="utf-8">',
        '<title>Happier browser Iroh shared endpoint proof</title>',
        '<script type="module" src="/harness.js"></script>',
        '',
      ].join('\n')],
      // The A7.3 page is a Metro bundle: a classic script, not an ES module.
      [PRODUCTION_CARRIER_SEAM_PAGE_PATH, [
        '<!doctype html>',
        '<meta charset="utf-8">',
        '<title>Happier browser Iroh production Home vertical proof</title>',
        `<script src="/${PRODUCTION_CARRIER_SEAM_BUNDLE}"></script>`,
        '',
      ].join('\n')],
    ]);
    server = startStaticServer({
      webOutputRoot,
      pages,
      harnessPath,
    });
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/`;

    // 3. Real browser, reported by build identity like the live gate. Chromium
    // remains the default and the only engine with a selectable channel.
    const playwright = await import('playwright');
    const browserEngine = resolveProofBrowserEngine(process.env.HAPPIER_IROH_PROOF_BROWSER);
    const browserType = playwright[browserEngine];
    const channel = browserEngine === 'chromium' ? process.env.PLAYWRIGHT_CHROMIUM_CHANNEL : undefined;
    const launchOptions = channel ? { channel } : {};
    const browser = await browserType.launch(launchOptions);
    const browserBuild = { engine: browserEngine, version: browser.version(), channel: channel ?? 'default' };

    const failures = [];
    const pageErrors = [];
    const report = { browserBuild, relayUrl, assetDir: packaged.assetDir };

    try {
      const context = await browser.newContext();

      // (1) Two tabs share one endpoint ID over one worker.
      const tabA = await openTab(context, base, pageErrors);
      const tabB = await openTab(context, base, pageErrors);
      const leaseA = await acquireLease(tabA, relayUrl);
      const leaseB = await acquireLease(tabB, relayUrl);
      if (leaseA.kind !== 'leaseAcquired') {
        bail(`tab A could not acquire a lease: ${JSON.stringify(leaseA)}`);
      }
      if (leaseB.kind !== 'leaseAcquired') {
        bail(`tab B could not acquire a lease: ${JSON.stringify(leaseB)}`);
      }
      const endpointId = leaseA.endpointId;
      report.twoTabsSharedEndpoint = {
        endpointId,
        tabA: leaseA,
        tabB: leaseB,
      };
      if (leaseB.endpointId !== endpointId) {
        failures.push(`two tabs saw two endpoint IDs: ${endpointId} vs ${leaseB.endpointId}`);
      }

      // (2) A reload preserves the endpoint ID.
      await tabA.reload({ waitUntil: 'load' });
      await connectClient(tabA, base);
      const reloaded = await acquireLease(tabA, relayUrl);
      report.endpointIdAfterReload = reloaded.kind === 'leaseAcquired' ? reloaded.endpointId : reloaded;
      if (reloaded.kind !== 'leaseAcquired' || reloaded.endpointId !== endpointId) {
        failures.push(`a reload changed the endpoint identity: ${JSON.stringify(reloaded)}`);
      }

      // (3) Releasing one client does not stop the sibling: both tabs are open
      // and holding leases, one releases everything it holds, the other keeps
      // transacting over the same endpoint.
      const released = await releaseAll(tabA);
      if (released.kind !== 'released') {
        failures.push(`releasing one client failed: ${JSON.stringify(released)}`);
      }
      const siblingStatus = await status(tabB);
      report.siblingAfterRelease = siblingStatus.kind === 'status' ? siblingStatus.status : siblingStatus;
      if (siblingStatus.kind !== 'status'
        || siblingStatus.status.state !== 'ready'
        || siblingStatus.status.endpointId !== endpointId) {
        failures.push(`releasing one client disturbed the sibling: ${JSON.stringify(siblingStatus)}`);
      }
      const siblingSecondLease = await acquireLease(tabB, relayUrl);
      if (siblingSecondLease.kind !== 'leaseAcquired' || siblingSecondLease.endpointId !== endpointId) {
        failures.push(`the sibling could not acquire again after the other client released: ${JSON.stringify(siblingSecondLease)}`);
      }

      // The endpoint identity belongs only to this live SharedWorker. Closing
      // every client may let the browser destroy that worker at any time, so
      // no cross-worker identity assertion belongs in this journey.
      await tabA.close();
      await tabB.close();

      if (pageErrors.length > 0) {
        failures.push(`browser page errors: ${pageErrors.join(' | ')}`);
      }

      // (6) A7.3/A7.4 — the loaded production page seam: the production carrier,
      // `serverFetch`, and Socket.IO owner, bundled by the canonical Metro/Expo
      // web owner and executed in a real Chromium. This is not the A7.3
      // completion journey; that still needs the native relay/Home fixture.
      if (productionPageSeam) {
        // Its own browser process keeps the loaded production seam isolated
        // from the focused A7.2 worker-ownership assertions above.
        const seamBrowser = await browserType.launch(launchOptions);
        const seamPageErrors = [];
        const seamPageUrl = `${base.replace(/\/$/u, '')}${PRODUCTION_CARRIER_SEAM_PAGE_PATH}`;
        try {
          const seamContext = await seamBrowser.newContext();
          const outcome = await runProductionCarrierPageSeam({
            webOutputRoot,
            pageErrors: seamPageErrors,
            openProofPage: async () => await openProductionCarrierPage(seamContext, seamPageUrl, seamPageErrors),
          });
          report.productionCarrierPageSeam = outcome.report;
          failures.push(...outcome.failures);
        } finally {
          await seamBrowser.close();
        }
      }

      // (7) A7.3 — the REAL Home vertical journey on that same production page,
      // with the stock local relay and a real Home acceptor in front of it.
      let journeyVerdict = null;
      if (realHomeVertical) {
        // Its own browser process keeps the loaded production journey isolated
        // from the focused A7.2 worker-ownership assertions above.
        const journeyBrowser = await browserType.launch(launchOptions);
        const journeyPageErrors = [];
        const journeyPageUrl = `${base.replace(/\/$/u, '')}${PRODUCTION_CARRIER_SEAM_PAGE_PATH}`;
        try {
          const journeyContext = await journeyBrowser.newContext();
          const outcome = await runRealHomeVerticalJourney({
            webOutputRoot,
            pageErrors: journeyPageErrors,
            openJourneyPage: async () => await openProductionCarrierPage(
              journeyContext,
              journeyPageUrl,
              journeyPageErrors,
            ),
          });
          journeyVerdict = outcome.verdict;
          report.realHomeVerticalJourney = {
            browserBuild,
            verdict: outcome.verdict,
            observations: outcome.observations,
            ...outcome.report,
          };
          if (outcome.verdict !== 'PASS') {
            failures.push(...outcome.failures.map((reason) => `A7.3 real Home vertical — ${reason}`));
          }
        } finally {
          await journeyBrowser.close();
        }
      }

      // (8) A7.4 — the real browser finite Machine transfer journey on that same
      // production page: the stock local relay, a real `happier/machine/1`
      // acceptor, the canonical daemon admission owner and a real signed V2
      // grant from the canonical server mint.
      let machineVerdict = null;
      if (machineTransferVertical) {
        // Its own browser process for the same reason as the stages above.
        const machineBrowser = await browserType.launch(launchOptions);
        const machinePageErrors = [];
        const machinePageUrl = `${base.replace(/\/$/u, '')}${PRODUCTION_CARRIER_SEAM_PAGE_PATH}`;
        try {
          let machineContext = await machineBrowser.newContext();
          const outcome = await runBrowserMachineTransferJourney({
            webOutputRoot,
            pageErrors: machinePageErrors,
            openJourneyPage: async () => await openProductionCarrierPage(
              machineContext,
              machinePageUrl,
              machinePageErrors,
            ),
            replaceJourneyPage: async (page) => {
              await page.close();
              await machineContext.close();
              machineContext = await machineBrowser.newContext();
              return await openProductionCarrierPage(
                machineContext,
                machinePageUrl,
                machinePageErrors,
              );
            },
          });
          machineVerdict = outcome.verdict;
          report.browserMachineTransferJourney = {
            browserBuild,
            verdict: outcome.verdict,
            observations: outcome.observations,
            ...outcome.report,
          };
          if (outcome.verdict !== 'PASS') {
            failures.push(...outcome.failures.map((reason) => `A7.4 browser Machine transfer — ${reason}`));
          }
        } finally {
          await machineBrowser.close();
        }
      }

      process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
      if (failures.length > 0) {
        bail(`browser Iroh ${productionPageSeam ? 'shared-endpoint proof + production page seam' : 'shared-endpoint proof'} FAILED:\n  ${failures.join('\n  ')}`);
      }
      process.stdout.write(
        '\nbrowser Iroh shared-endpoint proof: PASS '
        + '(two tabs share one live-worker endpoint ID; reload preserves it while the worker lives; a released client leaves the sibling live)\n',
      );
      if (productionPageSeam) {
        process.stdout.write(
          '\nbrowser Iroh production page seam (A7.3/A7.4): LOADED SEAM ONLY — NOT a completion gate.\n'
          + '  Established: the canonical Metro/Expo web owner bundles the production browser Iroh Home carrier, '
          + '`serverFetch`, the Socket.IO transport, and the browser machine carrier into one page; that page loads and '
          + `runs in real ${browserBuild.engine}; and the production machine-carrier owner executes there and refuses without a grant.\n`
          + '  NOT established: authenticated HTTP, a live Socket.IO update, reconnect, EndpointId enforcement, '
          + 'relay-only path, or cancellation against a real relay and a real Home acceptor — no relay, Home, grant, or '
          + 'admission was involved in this run. A7.3 and A7.4 remain open.\n',
        );
      }
      if (realHomeVertical) {
        // Reached only when every A7.3 observation was recorded true, because a
        // FAIL verdict pushed its reasons into `failures` and bailed above.
        process.stdout.write(
          `\nbrowser Iroh A7.3 real Home vertical: ${journeyVerdict}\n`
          + `  Observed through real ${browserBuild.engine}, the stock local relay, and a real Home acceptor: the exact configured `
          + 'relay to an ingress-less Home; authenticated HTTP through the production carrier; a live Socket.IO update; '
          + 'reconnect after a carrier-acceptor restart with no duplicate event; no application byte to a Home addressed by another '
          + "EndpointId; a relay-only observed path; prompt cancellation of a request the Home was holding, with no late "
          + 'completion; and release closing the Home connections.\n'
          + (machineTransferVertical
            ? '  A7.4 is reported independently below; the Home stage does not stand in for its Machine evidence.\n'
            : '  NOT established here: A7.4 browser Machine transfer, which remains its own gate.\n'),
        );
      }
      if (machineTransferVertical) {
        // Reached only when every finite-transfer observation was recorded true, because a
        // FAIL verdict pushed its reasons into `failures` and bailed above.
        process.stdout.write(
          `\nbrowser Iroh A7.4 browser Machine finite transfer: ${machineVerdict}\n`
          + `  Observed through real ${browserBuild.engine}, the stock local relay, a real happier/machine/1 acceptor, the canonical `
          + 'daemon admission owner, production direct-import/direct-export owners, and real signed V2 grants from the '
          + 'canonical server mint: relay-only dials to the real acceptor; grants binding the exact browser initiator '
          + 'EndpointId, target machine id/EndpointId, and finite-transfer carrier purpose; the prepared-transfer '
          + 'lifecycle independently authorizing operation and byte semantics; prepare, encrypted chunks, '
          + 'manifest/receipt finalization and exact destination bytes for file import/export and session-attachment '
          + 'upload; attachment destination semantics and cancellation cleanup; '
          + 'mis-bound role/endpoint/grant refusal and corrupted signed-grant rejection before application bytes; '
          + 'terminal no-fallback results after Iroh selection; a relay-only observed path; release closing the owned '
          + 'Machine stream; and terminal prepared-transfer-owner cleanup.\n',
        );
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (keepProofOutput) {
      process.stderr.write(`browser Iroh proof output retained at ${stagingDir}\n`);
    } else {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

// Only the CLI entry point runs the proof: the mode parser above is imported by
// its contract test, which must never launch a browser or a build.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
