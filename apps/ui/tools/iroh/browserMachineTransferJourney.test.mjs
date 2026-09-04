// Contract for the A7.4 browser finite Machine transfer mode of the one
// Chromium proof harness.
//
// The journey itself needs a Rust-built addon, a live relay, the canonical
// daemon machine/1 admission owner, a real signed V2 grant and a real Chromium,
// so it cannot run here. These are the checks that decide whether a run's
// verdict can be believed at all — the same shape the A7.3 contract uses,
// because A7.4 is the same harness with a Machine vertical, not a second one:
//
//   1. the one harness exposes the machine-transfer vertical as its own opt-in,
//      and every existing mode stays available and separately named;
//   2. the journey declares exactly the A7.4 observations the amendment
//      requires, so the list cannot silently shrink;
//   3. a verdict is PASS only when every one of those observations was actually
//      recorded true — a missing or false observation, or any failure, must
//      never print PASS; and
//   4. the daemon side is the CANONICAL admission and grant owners, named as
//      module paths that really exist, so the journey cannot drift into a
//      hand-rolled acceptor or a fabricated signature.
//
// Plus the vacuity guard: every page command the journey drives must really
// exist on the production seam page, and the native fixture must really expose
// the machine lifecycle the journey asks it for.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const toolsIrohDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolsIrohDir, '..', '..', '..', '..');

/** The exact A7.4 finite-transfer observations. */
const REQUIRED_OBSERVATIONS = [
  'exactRelayToRealMachineAcceptor',
  'signedGrantBindsInitiatorTargetAndFiniteTransferPurpose',
  'replacementWorkerMintsFreshEndpointAndLaterGrantBindsIt',
  'productionImportPrepareEncryptedChunksFinalizeReceiptAndDestinationBytes',
  'productionExportPrepareEncryptedChunksManifestResultAndDestinationBytes',
  'productionImportCancellationAbortsOwnedSessionWithoutDestination',
  'productionExportCancellationCleansDestination',
  'attachmentGrantUsesFiniteTransferCarrierPurpose',
  'productionAttachmentImportPrepareEncryptedChunksFinalizeReceiptAndDestinationBytes',
  'productionAttachmentCancellationAndTerminalFailureDoNotFallback',
  'wrongPeerRoleEndpointOrGrantRejectedBeforeApplicationBytes',
  'terminalSelectedIrohFailureDoesNotFallbackForImportOrExport',
  'browserReportsRelayOnlyNeverDirect',
  'releaseClosesOwnedMachineStream',
];

test('the one harness opts into the machine-transfer vertical without losing any existing mode', async () => {
    const harness = await import(resolve(toolsIrohDir, 'runBrowserIrohSharedEndpointProof.mjs'));

    assert.deepEqual(harness.parseProofModes([]), {
        productionPageSeam: false,
        realHomeVertical: false,
        machineTransferVertical: false,
    });
    assert.deepEqual(
        harness.parseProofModes(['--production-page-seam']),
        { productionPageSeam: true, realHomeVertical: false, machineTransferVertical: false },
        'the loaded-seam-only mode must remain available under its own name',
    );
    assert.deepEqual(
        harness.parseProofModes(['--real-home-vertical']),
        { productionPageSeam: false, realHomeVertical: true, machineTransferVertical: false },
        'the A7.3 Home vertical must remain available under its own name',
    );
    assert.deepEqual(
        harness.parseProofModes(['--machine-transfer-vertical']),
        { productionPageSeam: false, realHomeVertical: false, machineTransferVertical: true },
        'the A7.4 Machine vertical must be its own opt-in, not a rename of the Home vertical',
    );
});

test('the journey declares exactly the A7.4 finite-transfer observations', async () => {
    const journey = await import(resolve(toolsIrohDir, 'runBrowserMachineTransferJourney.mjs'));
    assert.deepEqual([...journey.REQUIRED_A74_OBSERVATIONS].sort(), [...REQUIRED_OBSERVATIONS].sort());
});

test('the Chromium journey consumes the canonical direct import/export owners instead of fixture transfer endpoints', () => {
    const journeySource = readFileSync(resolve(toolsIrohDir, 'runBrowserMachineTransferJourney.mjs'), 'utf8');
    const pageSource = readFileSync(resolve(toolsIrohDir, 'productionCarrierSeamPage.ts'), 'utf8');

    assert.match(pageSource, /uploadBulkPayloadFromFileWithCarrierFallbacks/u);
    assert.match(pageSource, /downloadBulkPayloadViaDirectExportToDestination/u);
    assert.match(journeySource, /createDirectTransferServerLifecycle/u);
    assert.match(journeySource, /registerMachineDirectTransferImportRpcHandlers/u);
    assert.match(journeySource, /registerMachineDirectTransferExportRpcHandlers/u);
    assert.doesNotMatch(journeySource, /\/v1\/machine\/transfer\/(upload|download|hold)/u);
});

test('the Chromium journey composes attachments through the existing transfer owners', () => {
    const journeySource = readFileSync(resolve(toolsIrohDir, 'runBrowserMachineTransferJourney.mjs'), 'utf8');
    const pageSource = readFileSync(resolve(toolsIrohDir, 'productionCarrierSeamPage.ts'), 'utf8');

    assert.match(pageSource, /uploadSessionAttachmentFromReaderWithCarrierFallbacks/u);
    assert.match(pageSource, /await uploadSessionAttachmentFromReaderWithCarrierFallbacks\(\{/u);
    assert.match(journeySource, /allowedFlows:\s*\[FINITE_TRANSFER_CARRIER_FLOW\]/u);
    assert.match(journeySource, /productionAttachmentImportPrepareEncryptedChunksFinalizeReceiptAndDestinationBytes/u);
    assert.match(journeySource, /productionAttachmentCancellationAndTerminalFailureDoNotFallback/u);
    assert.doesNotMatch(
        journeySource,
        /productionAttachmentExport/u,
        'a workspace-file export must not be relabeled as an attachment export',
    );
});

test('a verdict is PASS only when every required observation was really recorded', async () => {
    const { REQUIRED_A74_OBSERVATIONS, evaluateBrowserMachineTransferJourney } = await import(
        resolve(toolsIrohDir, 'runBrowserMachineTransferJourney.mjs')
    );
    const complete = Object.fromEntries(REQUIRED_A74_OBSERVATIONS.map((name) => [name, true]));

    assert.equal(evaluateBrowserMachineTransferJourney({ observations: complete, failures: [] }).verdict, 'PASS');

    // A run that simply never reached an observation must not pass.
    const { [REQUIRED_A74_OBSERVATIONS[0]]: _dropped, ...missingOne } = complete;
    const missing = evaluateBrowserMachineTransferJourney({ observations: missingOne, failures: [] });
    assert.equal(missing.verdict, 'FAIL');
    assert.ok(
        missing.reasons.some((reason) => reason.includes(REQUIRED_A74_OBSERVATIONS[0])),
        'the verdict must name the observation that never ran',
    );

    // An observation that ran and was false is not a pass either.
    assert.equal(
        evaluateBrowserMachineTransferJourney({
            observations: { ...complete, [REQUIRED_A74_OBSERVATIONS[1]]: false },
            failures: [],
        }).verdict,
        'FAIL',
    );

    // Nor is a complete observation set that also collected a failure.
    assert.equal(
        evaluateBrowserMachineTransferJourney({ observations: complete, failures: ['machine saw no bytes'] }).verdict,
        'FAIL',
    );

    // An empty run is the most important case: nothing observed, nothing passed.
    assert.equal(evaluateBrowserMachineTransferJourney({ observations: {}, failures: [] }).verdict, 'FAIL');
});

test('every page command the journey drives really exists on the production seam page', async () => {
    const { REQUIRED_MACHINE_JOURNEY_PAGE_COMMANDS } = await import(
        resolve(toolsIrohDir, 'runBrowserMachineTransferJourney.mjs')
    );
    const pageSource = readFileSync(resolve(toolsIrohDir, 'productionCarrierSeamPage.ts'), 'utf8');
    for (const name of REQUIRED_MACHINE_JOURNEY_PAGE_COMMANDS) {
        assert.match(
            pageSource,
            new RegExp(`^\\s{4}${name}:`, 'mu'),
            `the seam page must expose the ${name} command the journey drives`,
        );
    }
});

test('the machine lifecycle the journey asks the shared native fixture for really exists', async () => {
    const { REQUIRED_MACHINE_FIXTURE_OPERATIONS } = await import(
        resolve(toolsIrohDir, 'runBrowserMachineTransferJourney.mjs')
    );
    const fixture = await import(
        resolve(repoRoot, 'packages/iroh-native/scripts/browserIrohNativeHomeFixture.mjs')
    );
    const fixtureSource = readFileSync(
        resolve(repoRoot, 'packages/iroh-native/scripts/browserIrohNativeHomeFixture.mjs'),
        'utf8',
    );
    assert.equal(
        typeof fixture.createBrowserIrohNativeHomeFixture,
        'function',
        'the machine vertical must reuse the one shared native relay/acceptor fixture',
    );
    for (const name of REQUIRED_MACHINE_FIXTURE_OPERATIONS) {
        assert.match(
            fixtureSource,
            new RegExp(`^\\s{4}${name}:`, 'mu'),
            `the shared native fixture must expose the ${name} lifecycle the machine journey drives`,
        );
    }
});

/**
 * The false-acceptance guard. A7.4 fails the moment its daemon side is anything
 * other than the canonical owners: a hand-rolled admission responder or a
 * hand-signed grant would let a run "pass" while proving nothing about the real
 * `happier/machine/1` acceptance path.
 */
test('the daemon side is the canonical admission and grant-signing owners', async () => {
    const { CANONICAL_DAEMON_OWNERS } = await import(resolve(toolsIrohDir, 'runBrowserMachineTransferJourney.mjs'));
    assert.ok(
        CANONICAL_DAEMON_OWNERS.admissionModule.endsWith(
            'apps/cli/src/daemon/peer/mediation/loopback/server.ts',
        ),
        'admission must come from the canonical daemon peer-mediation loopback owner',
    );
    assert.ok(
        CANONICAL_DAEMON_OWNERS.grantMintModule.endsWith(
            'apps/server/sources/app/machines/peer/mediation/mintDirectRouteGrantV1.ts',
        ),
        'the grant must be signed by the canonical server mint owner',
    );
    for (const relativePath of Object.values(CANONICAL_DAEMON_OWNERS)) {
        assert.ok(
            existsSync(resolve(repoRoot, relativePath)),
            `${relativePath} does not exist; the canonical-owner check would be vacuous`,
        );
    }
    const journeySource = readFileSync(resolve(toolsIrohDir, 'runBrowserMachineTransferJourney.mjs'), 'utf8');
    assert.match(
        journeySource,
        /startPeerMediationLoopbackServer/u,
        'the journey must start the canonical admission server, not answer admissions itself',
    );
    assert.match(
        journeySource,
        /mintDirectRouteGrantV2/u,
        'the journey must mint through the canonical server grant owner, not sign a payload itself',
    );
});
